const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    seats: { type: Number, required: true },
    shape: { type: String, enum: ['round', 'rectangular'], default: 'round' },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    rotation: { type: Number, default: 0 }
});

module.exports = mongoose.model('Table', tableSchema);
