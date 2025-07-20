// Import required modules
const express = require('express');
const db = require('../db');   // PostgreSQL connection (commented out in logic)
const db2 = require('../db2'); // SQLite3 connection (used in logic)
const router = express.Router();

// Regex to validate phone numbers (7 to 15 digits, optional +, spaces or dashes)
const phoneRegex = /^[+]?[\d\s\-]{7,15}$/;

// POST / (appointment booking endpoint)
router.post('/', async (req, res) => {
  const {
    customer_name,
    contact_number,
    service_type,
    appointment_date,
    time_slot,
    location
  } = req.body;

  // Parse and validate appointment date
  const appointmentDate = new Date(appointment_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize current date to midnight

  // Validate contact number format
  if (!phoneRegex.test(contact_number)) {
    return res.status(400).send("Invalid contact number.");
  }

  // Ensure the appointment is scheduled for today or later
  if (appointmentDate < today) {
    return res.status(400).send("Appointment date must be in the future.");
  }

  try {
    // Optional: PostgreSQL insertion (commented out for SQLite use only)
    /*
    await db.query(
      'INSERT INTO appointments (customer_name, contact_number, service_type, appointment_date, time_slot, location) VALUES ($1, $2, $3, $4, $5, $6)',
      [customer_name, contact_number, service_type, appointment_date, time_slot, location]
    );
    */

    // SQLite3 insertion (currently active)
    db2.run(
      `INSERT INTO appointments (customer_name, contact_number, service_type, appointment_date, time_slot, location)
       VALUES (?, ?, ?, ?, ?, ?)`,  // Use `?` placeholders in SQLite
      [customer_name, contact_number, service_type, appointment_date, time_slot, location],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).send('Error booking appointment');
        }
        res.send('Appointment booked successfully!');
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).send('Error booking appointment');
  }
});

module.exports = router;
