const express = require('express');
const db2 = require('../db2');  // Database connection/module
const bcrypt = require('bcrypt'); // For hashing passwords
const router = express.Router();
const path = require('path');

// Load public holidays list from JSON file (used to block bookings on those dates)
const publicHolidays = require('../publicHolidays.json');

// Setup nodemailer email transporter for sending confirmation emails
const nodemailer = require('nodemailer');
require('dotenv').config(); // Load environment variables from .env

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your email from .env
    pass: process.env.EMAIL_PASS  // Your app password from .env
  }
});

// Regex for validating phone number format (allows +, digits, spaces, hyphens, length 7-15)
const phoneRegex = /^[+]?[\d\s\-]{7,15}$/;

// POST /
// Endpoint for booking a repair appointment
router.post('/', async (req, res) => {
  // Destructure form data from request body
  const {
    first_name,
    last_name,
    contact_number,
    registration,
    email_address,
    repair_type,
    specific_repair,
    appointment_date,
    time_slot,
    location
  } = req.body;

  // Parse appointment date and create today's date (set to start of day)
  const appointmentDate = new Date(appointment_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Validate contact number against regex
  if (!phoneRegex.test(contact_number)) {
    return res.status(400).send("Invalid contact number.");
  }

  // Validate appointment date is in the future (not today or past)
  if (appointmentDate < today) {
    return res.status(400).send("Appointment date must be in the future.");
  }

  // Validate that time slot is within operating hours 7:00 to 17:00
  const [hour, minute] = time_slot.split(":").map(Number);
  if (hour < 7 || hour > 17 || (hour === 17 && minute > 0)) {
    return res.status(400).send("Appointment time must be within business hours (7:00-17:00).");
  }

  // Valid time slots allowed for booking
  const validTimeSlots = [
    "08:00", "09:00", "10:00", "11:00",
    "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"
  ];

  // Check if chosen time slot is one of the allowed slots
  if (!validTimeSlots.includes(time_slot)) {
    return res.status(400).send("Invalid time slot selected.");
  }

  // Format appointment date as YYYY-MM-DD to check against public holidays
  const formattedDate = appointment_date.split("T")[0];
  if (publicHolidays.includes(formattedDate)) {
    return res.status(400).send("Bookings cannot be made on public holidays.");
  }

  // Check if the appointment slot already has 2 bookings (max allowed)
  const bookingCount = await new Promise((resolve, reject) => {
    db2.get(
      `SELECT COUNT(*) AS count FROM appointment WHERE AppointmentDate = ? AND TimeSlot = ? AND Location = ?`,
      [appointment_date, time_slot, location],
      (err, row) => {
        if (err) return reject(err);
        resolve(row.count);
      }
    );
  });

  // If 2 or more bookings exist, reject with conflict
  if (bookingCount >= 2) {
    return res.status(409).send("This time slot and location already has two bookings. Please choose another.");
  }

  try {
    db2.serialize(() => {
      // Step 1: Check if user with the given email or phone number exists
      db2.get(`
        SELECT * FROM user WHERE EmailAddress = ? OR PhoneNumber = ?
      `, [email_address, contact_number], async (err, user) => {
        if (err) {
          console.error("Error checking user:", err);
          return res.status(500).send("Database error.");
        }

        let userId;

        // If user does not exist, create a new user with default password
        if (!user) {
          // Generate a default password based on name, contact, and timestamp
          const rawPassword = `${first_name}-${last_name}-${contact_number}-${Date.now()}`;
          const hashedPassword = await bcrypt.hash(rawPassword, 10);
          console.log(`default password of ${first_name} ${last_name}: ${rawPassword}`);

          // Insert new user into user table
          db2.run(`
            INSERT INTO user (FirstName, LastName, Password, PhoneNumber, EmailAddress, UserType)
            VALUES (?, ?, ?, ?, ?, 'CUSTOMER')
          `, [first_name, last_name, hashedPassword, contact_number, email_address], function (err) {
            if (err) {
              console.error("Error inserting user:", err);
              return res.status(500).send("Failed to create user.");
            }

            userId = this.lastID; // Get inserted user ID
            checkVehicleAndProceed(userId);
          });
        } else {
          // User exists, proceed with their ID
          userId = user.UserID;
          checkVehicleAndProceed(userId);
        }

        // Function to check vehicle ownership and proceed with booking
        function checkVehicleAndProceed(userId) {
          // Verify vehicle is registered and belongs to the user
          db2.get(`
            SELECT * FROM vehicle WHERE Registration = ?
          `, [registration], (err, vehicle) => {
            if (err) {
              console.error("Error checking vehicle:", err);
              return res.status(500).send("Database error.");
            }

            if (!vehicle) {
              return res.status(404).send("Vehicle is not registered in the system.");
            }

            if (vehicle.UserID !== userId) {
              return res.status(403).send("This vehicle is not registered to you.");
            }

            // Proceed to create the appointment
            proceedWithAppointment(userId);

            // Send email confirmation after successful appointment insert
            transporter.sendMail({
              from: process.env.EMAIL_USER,
              to: email_address,
              subject: 'AMW Repair Appointment Confirmation',
              text: `
Hi ${first_name},

Your repair appointment has been confirmed with the following details:

- Date: ${appointment_date}
- Time: ${time_slot}
- Location: ${location}
- Vehicle: ${registration}
- Repair Type: ${repair_type}
- Specific Repair: ${specific_repair}

Thank you for booking with AMW!

Regards,
AMW Team`
            }, (error, info) => {
              if (error) {
                console.error("Error sending email:", error);
                return res.status(500).send("Appointment booked, but failed to send confirmation email.");
              }
              console.log("Confirmation email sent:", info.response);
              return res.send("Appointment booked successfully! A confirmation email has been sent.");
            });
          });
        }

        // Function to insert appointment and repair task into database
        function proceedWithAppointment(userId) {
          // Insert appointment record with status 'SCHEDULED'
          db2.run(`
            INSERT INTO appointment (UserID, Registration, AppointmentDate, TimeSlot, Location, AppointmentStatus)
            VALUES (?, ?, ?, ?, ?, 'SCHEDULED')
          `, [userId, registration, appointment_date, time_slot, location], function (err) {
            if (err) {
              console.error("Error inserting appointment:", err);
              return res.status(500).send("Failed to create appointment.");
            }

            const appointmentId = this.lastID;

            // Insert repair details linked to the appointment
            db2.run(`
              INSERT INTO repair (AppointmentID, Registration, RepairType, SpecificRepairs)
              VALUES (?, ?, ?, ?)
            `, [appointmentId, registration, repair_type, specific_repair], (err) => {
              if (err) {
                console.error("Error inserting repair:", err);
                return res.status(500).send("Failed to log repair task.");
              }

              return res.send("Repair appointment booked successfully!");
            });
          });
        }
      });
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).send("Error booking repair appointment.");
  }
});

// GET /
// Render the repair booking page for logged-in users
router.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login'); // Redirect to login if not authenticated
  }

  const userId = req.session.user.UserID;

  // Fetch all vehicle registrations belonging to the logged-in user
  db2.all(
    `SELECT Registration FROM vehicle WHERE UserID = ?`,
    [userId],
    (err, vehicles) => {
      if (err) {
        console.error("Error fetching vehicles:", err);
        return res.status(500).send("Database error");
      }

      // Render the booking page, passing user info and list of vehicles
      res.render('bookrepair', {
        user: req.session.user,
        vehicles: vehicles
      });
    }
  );
});

module.exports = router;
