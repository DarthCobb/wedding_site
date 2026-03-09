const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    id: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: String, required: true },
    note: { type: String },
    attachment: { type: String }
}, { _id: false });

const vendorSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: [String], default: [] },
    contact: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    dueDate: { type: String },
    payments: { type: [paymentSchema], default: [] }
});

module.exports = mongoose.model('Vendor', vendorSchema);
