require('dotenv').config({ path: '../.env' });
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const Brevo = require('@getbrevo/brevo');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- Request Logger ---
app.use((req, res, next) => {
    const hasBody = req.method !== 'GET' && req.method !== 'DELETE';
    console.log(`\n[REQUEST] ${req.method} ${req.path}`);
    if (hasBody && req.body && Object.keys(req.body).length > 0) {
        console.log('[PAYLOAD]', JSON.stringify(req.body, null, 2));
    }
    next();
});

const client = new MongoClient(process.env.MONGODB_CONNECTION_STRING, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db;

async function startServer() {
    await client.connect();
    db = client.db('WeddingDB');
    console.log('Connected to MongoDB');

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// --- Auth Middleware ---
const requireAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const config = await db.collection('sitedata').findOne({ _id: 'siteconfig' });

        // If an adminPassword is set, verify the authorization header matches it
        if (config && config.adminPassword) {
            if (!authHeader || authHeader !== config.adminPassword) {
                return res.status(401).json({ error: 'Unauthorized: Invalid admin password' });
            }
        }

        next();
    } catch (error) {
        res.status(500).json({ error: 'Authentication failed' });
    }
};

// --- Auth Route ---
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { password } = req.body;
        const config = await db.collection('sitedata').findOne({ _id: 'siteconfig' });
        if (config && config.adminPassword && password === config.adminPassword) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// --- Site Data Routes ---
app.get('/api/sitedata/rsvp', async (req, res) => {
    try {
        const data = await db.collection('sitedata').findOne({ _id: 'siteconfig' });
        if (data) {
            res.json({
                person1: data.person1,
                person2: data.person2
            });
        } else {
            res.json(null);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/sitedata/guest', async (req, res) => {
    try {
        const data = await db.collection('sitedata').findOne({ _id: 'siteconfig' });
        if (data) {
            res.json({
                person1: data.person1,
                person2: data.person2,
                aboutUs: data.aboutUs,
                location: data.location,
                eventDate: data.eventDate,
                registryUrl: data.registryUrl
            });
        } else {
            res.json(null);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/sitedata', requireAdmin, async (req, res) => {
    try {
        const data = await db.collection('sitedata').findOne({ _id: 'siteconfig' });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/sitedata', requireAdmin, async (req, res) => {
    try {
        const update = req.body;
        delete update._id; // prevent _id mutation
        console.log('[API] Updating sitedata');
        const result = await db.collection('sitedata').findOneAndUpdate(
            { _id: 'siteconfig' },
            { $set: update },
            { returnDocument: 'after', upsert: true }
        );
        console.log('[RESPONSE] sitedata updated OK');
        res.json(result);
    } catch (error) {
        console.error('[ERROR] Failed to update sitedata:', error.message);
        res.status(400).json({ error: error.message });
    }
});

// --- Guest Routes ---
app.get('/api/guests', requireAdmin, async (req, res) => {
    try {
        const guests = await db.collection('guests').find().toArray();
        res.json(guests);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/guests', async (req, res) => {
    try {
        const guest = req.body;
        console.log('[API] Inserting guest into MongoDB:', guest.name);
        await db.collection('guests').insertOne(guest);
        console.log('[RESPONSE] Guest saved OK:', guest.id);
        res.status(201).json(guest);
    } catch (error) {
        console.error('[ERROR] Failed to insert guest:', error.message);
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/guests/:id', async (req, res) => {
    try {
        const { _id, ...update } = req.body;
        const result = await db.collection('guests').findOneAndUpdate(
            { id: req.params.id },
            { $set: update },
            { returnDocument: 'after' }
        );
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/guests/:id', async (req, res) => {
    try {
        await db.collection('guests').deleteOne({ id: req.params.id });
        res.json({ message: 'Guest deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/guests/lookup', async (req, res) => {
    try {
        const { email, eventCode } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const config = await db.collection('sitedata').findOne({ _id: 'siteconfig' });
        if (config && config.eventCode) {
            if (!eventCode || eventCode.trim().toLowerCase() !== config.eventCode.toLowerCase()) {
                return res.status(401).json({ error: 'Invalid Event Code. Please check your invitation.' });
            }
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Find matching guest (or couple login via 'host')
        const allGuests = await db.collection('guests').find().toArray();
        const match = allGuests.find(g =>
            (g.contact && g.contact.toLowerCase() === normalizedEmail) ||
            (g.isCouple && normalizedEmail === 'host')
        );

        if (match) {
            // Strip any highly sensitive fields if needed but for RSVP we need standard fields
            res.json(match);
        } else {
            res.status(404).json({ error: 'No invitation found with that email' });
        }
    } catch (error) {
        console.error('[ERROR] Failed during guest lookup:', error);
        res.status(500).json({ error: 'Internal server error during lookup' });
    }
});

// --- Vendor Routes ---
app.get('/api/vendors', requireAdmin, async (req, res) => {
    try {
        const vendors = await db.collection('vendors').find().toArray();
        res.json(vendors);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/vendors', async (req, res) => {
    try {
        const vendor = req.body;
        console.log('[API] Inserting vendor into MongoDB:', vendor.name);
        await db.collection('vendors').insertOne(vendor);
        console.log('[RESPONSE] Vendor saved OK:', vendor.id);
        res.status(201).json(vendor);
    } catch (error) {
        console.error('[ERROR] Failed to insert vendor:', error.message);
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/vendors/:id', async (req, res) => {
    try {
        const { _id, ...update } = req.body;
        const result = await db.collection('vendors').findOneAndUpdate(
            { id: req.params.id },
            { $set: update },
            { returnDocument: 'after' }
        );
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/vendors/:id', async (req, res) => {
    try {
        await db.collection('vendors').deleteOne({ id: req.params.id });
        res.json({ message: 'Vendor deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Carousel Routes ---
app.get('/api/carousel', (req, res) => {
    try {
        const carouselDir = path.join(__dirname, '..', 'public', 'carousel');
        if (!fs.existsSync(carouselDir)) {
            return res.json([]);
        }

        const files = fs.readdirSync(carouselDir);
        // Filter out non-images just in case
        const images = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        });

        // Map to the public path that the frontend expects
        const imagePaths = images.map(img => `/carousel/${img}`);
        res.json(imagePaths);
    } catch (error) {
        console.error('[ERROR] Failed to read carousel directory:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- Table (Seating Chart) Routes ---
app.get('/api/tables', requireAdmin, async (req, res) => {
    try {
        const tables = await db.collection('tables').find().toArray();
        res.json(tables);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tables', async (req, res) => {
    try {
        if (Array.isArray(req.body)) {
            await db.collection('tables').insertMany(req.body);
            res.status(201).json({ message: 'Tables seeded' });
        } else {
            const table = req.body;
            await db.collection('tables').insertOne(table);
            res.status(201).json(table);
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/tables/sync', async (req, res) => {
    try {
        await db.collection('tables').deleteMany({});
        const newTables = req.body;
        if (newTables.length > 0) {
            await db.collection('tables').insertMany(newTables);
        }
        res.json(newTables);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/tables/:id', async (req, res) => {
    try {
        const { _id, ...update } = req.body;
        const result = await db.collection('tables').findOneAndUpdate(
            { id: req.params.id },
            { $set: update },
            { returnDocument: 'after' }
        );
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/tables/:id', async (req, res) => {
    try {
        await db.collection('tables').deleteOne({ id: req.params.id });
        res.json({ message: 'Table deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Email Invite Route ---
app.post('/api/send-invites', async (req, res) => {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    const senderName = process.env.BREVO_SENDER_NAME || 'The Couple';
    const rsvpBaseUrl = process.env.BREVO_RSVP_BASE_URL || 'http://localhost:5173';

    if (!apiKey || apiKey.includes('YOUR_API_KEY')) {
        return res.status(500).json({ error: 'BREVO_API_KEY is not configured in .env' });
    }
    if (!senderEmail || senderEmail.includes('your-verified-email')) {
        return res.status(500).json({ error: 'BREVO_SENDER_EMAIL is not configured in .env' });
    }

    try {
        const { guestIds } = req.body;

        // Fetch all guests
        const allGuests = await db.collection('guests').find().toArray();

        // Filter eligible: has email contact, not a couple host, not already invited
        // If specific guestIds provided, restrict to those
        const eligible = allGuests.filter(g => {
            if (g.isCouple) return false;
            if (!g.contact || !g.contact.includes('@')) return false;
            if (g.inviteSent) return false;
            if (guestIds && guestIds.length > 0 && !guestIds.includes(g.id)) return false;
            return true;
        });

        const skipped = allGuests.filter(g => {
            if (g.isCouple) return false;
            if (!g.contact || !g.contact.includes('@')) return true;
            if (g.inviteSent) return true;
            return false;
        }).length;

        console.log(`[INVITES] Sending to ${eligible.length} guests, skipping ${skipped}`);

        if (eligible.length === 0) {
            return res.json({ sent: 0, skipped, errors: [], message: 'No eligible guests to invite.' });
        }

        // Set up Brevo SDK
        const emailAPI = new Brevo.TransactionalEmailsApi();
        emailAPI.authentications['apiKey'].apiKey = apiKey;

        const siteData = await db.collection('sitedata').findOne({ _id: 'siteconfig' });
        const eventDate = siteData ? new Date(siteData.eventDate).toLocaleDateString('en-ZA', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : 'our special day';
        const coupleName = siteData
            ? `${siteData.person1.name} & ${siteData.person2.name}`
            : senderName;
        const venueName = siteData?.location?.name || 'our venue';

        const sent = [];
        const errors = [];

        // Use BREVO_TEMPLATE_ID from env, or default to 1, since you only have one template
        const activeTemplateId = process.env.BREVO_TEMPLATE_ID ? parseInt(process.env.BREVO_TEMPLATE_ID, 10) : 1;

        for (const guest of eligible) {
            const firstName = guest.name.split(' ')[0];
            const rsvpLink = `${rsvpBaseUrl}/rsvp`;

            try {
                const message = new Brevo.SendSmtpEmail();
                message.templateId = activeTemplateId;
                message.to = [{ email: guest.contact, name: guest.name }];
                message.params = {
                    rsvpBaseUrl: rsvpBaseUrl,
                    coupleName: coupleName,
                    firstName: firstName,
                    eventDate: eventDate,
                    venueName: venueName,
                    rsvpLink: rsvpLink
                };

                await emailAPI.sendTransacEmail(message);
                console.log(`[INVITES] Sent to ${guest.name} <${guest.contact}>`);

                // Mark as invited in MongoDB
                await db.collection('guests').updateOne(
                    { id: guest.id },
                    { $set: { inviteSent: true } }
                );
                sent.push(guest.name);
            } catch (emailErr) {
                console.error(`[INVITES] Failed for ${guest.name}:`, emailErr.body || emailErr.message);
                errors.push({ name: guest.name, error: emailErr.body?.message || emailErr.message });
            }
        }

        console.log(`[INVITES] Done. Sent: ${sent.length}, Errors: ${errors.length}`);
        res.json({ sent: sent.length, skipped, errors, sentNames: sent });

    } catch (error) {
        console.error('[INVITES] Unexpected error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
