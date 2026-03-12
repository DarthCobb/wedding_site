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

// --- Site Data Routes ---
app.get('/api/sitedata', async (req, res) => {
    try {
        const data = await db.collection('sitedata').findOne({ _id: 'siteconfig' });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/sitedata', async (req, res) => {
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

        for (const guest of eligible) {
            const firstName = guest.name.split(' ')[0];
            const rsvpLink = `${rsvpBaseUrl}/rsvp`;

            const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap');
  body { font-family: 'Inter', Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
  .wrapper { max-width: 560px; margin: 40px auto; background: #0f172a; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border: 1px solid #1e293b; }
  .header { padding: 48px 40px 24px; text-align: center; }
  .header h1 { font-family: 'Playfair Display', Georgia, serif; color: #ffffff; font-size: 42px; margin: 0 0 12px; font-weight: 400; }
  .header p { color: #94a3b8; font-size: 14px; margin: 0; text-transform: uppercase; letter-spacing: 3px; font-weight: 600; }
  .body { padding: 0 40px 40px; color: #cbd5e1; line-height: 1.8; text-align: center; }
  .body h2 { font-family: 'Inter', Arial, sans-serif; font-size: 20px; color: #ffffff; margin-top: 0; font-weight: 500; }
  .detail { background: #1e293b; padding: 24px; border-radius: 16px; margin: 32px 0; border: 1px solid #334155; }
  .detail p { margin: 8px 0; font-size: 15px; color: #e2e8f0; }
  .detail strong { color: #ffffff; font-weight: 600; }
  .btn { display: inline-block; margin: 8px auto 32px; background: #ffffff; color: #0f172a !important; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-size: 16px; font-weight: 600; font-family: 'Inter', sans-serif; transition: background 0.3s; }
  .footer { text-align: center; padding: 24px; color: #64748b; font-size: 13px; border-top: 1px solid #1e293b; background: #0b1120; }
</style>
</head>
<body style="background-color: #f8fafc;">
<div style="padding: 20px;">
<div class="wrapper">
  <div class="header">
    <div style="text-align: center; margin-bottom: 12px;">
      <img src="${rsvpBaseUrl}/Accent%204.png" alt="" style="height: 40px; vertical-align: middle; margin-right: 12px; object-fit: contain;" />
      <h1 style="display: inline-block; vertical-align: middle; margin: 0;">${coupleName}</h1>
      <img src="${rsvpBaseUrl}/Accent%204.png" alt="" style="height: 40px; vertical-align: middle; margin-left: 12px; object-fit: contain; transform: scaleX(-1);" />
    </div>
    <p>Wedding Invitation</p>
  </div>
  <div class="body">
    <h2>Dear ${firstName},</h2>
    <p>We are delighted to invite you to celebrate our wedding day with us. Your presence would mean the world to us.</p>
    <div class="detail">
      <p><strong>📅 Date:</strong> ${eventDate}</p>
      <p><strong>📍 Venue:</strong> ${venueName}</p>
    </div>
    <p style="margin-bottom: 24px;">Please let us know if you'll be joining us by clicking the button below.</p>
    <a class="btn" href="${rsvpLink}">RSVP Now</a>
    <p style="font-size:13px;color:#64748b;">Or copy this link:<br> <a href="${rsvpLink}" style="color:#94a3b8; word-break: break-all;">${rsvpLink}</a></p>
  </div>
  <div class="footer">
    <p style="margin: 0;">With love, ${coupleName} 💍</p>
  </div>
</div>
</div>
</body>
</html>`;

            try {
                const message = new Brevo.SendSmtpEmail();
                message.subject = `You're invited to ${coupleName}'s Wedding! 💍`;
                message.htmlContent = htmlContent;
                message.sender = { name: senderName, email: senderEmail };
                message.to = [{ email: guest.contact, name: guest.name }];

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
