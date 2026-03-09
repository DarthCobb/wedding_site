const mongoose = require('mongoose');

const guestSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    rsvp: { type: String, enum: ['Pending', 'Confirmed', 'Declined'], default: 'Pending' },
    dietary: { type: String, default: '' },
    contact: { type: String, default: '' },
    tableId: { type: String, default: null },
    seatIndex: { type: Number, default: null },
    songRequests: { type: [String], default: [] },
    isCouple: { type: Boolean, default: false }
});

module.exports = mongoose.model('Guest', guestSchema);
