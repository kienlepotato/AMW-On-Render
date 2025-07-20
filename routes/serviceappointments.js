const express = require('express');             // Express framework for routing
const db2 = require('../db2');                   // SQLite database connection module
const bcrypt = require('bcrypt');                 // For password hashing
const router = express.Router();                  // Create an Express router instance
const path = require('path');                     

// Load public holidays from JSON file for booking validation
const publicHolidays = require('../publicHolidays.json');

// Setup Nodemailer for sending confirmation emails
const nodemailer = require('nodemailer');
require('dotenv').config();                        // Load environment variables (like email credentials)

// Configure the email transporter to use Gmail and auth credentials from env variables
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Regular expression to validate phone numbers (allows digits, spaces, dashes, optional leading +)
const phoneRegex = /^[+]?[\d\s\-]{7,15}$/;

// POST endpoint to handle booking an appointment
router.post('/', async (req, res) => {
  // Extract booking and user details from request body
  const {
    first_name, last_name, contact_number, email_address,
    registration, appointment_date, time_slot, location,
    odometer_km, logbook_interval, service_type, specific_service,
    clean_type // Optional cleaning service type
  } = req.body;

  // Parse the appointment date and get current date for validation
  const appointmentDate = new Date(appointment_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);  // Reset time part to midnight for accurate comparison

  // Validate the contact number format using regex
  if (!phoneRegex.test(contact_number)) {
    return res.status(400).send("Invalid contact number.");
  }

  // Ensure appointment date is not in the past
  if (appointmentDate < today) {
    return res.status(400).send("Appointment date must be in the future.");
  }

  // Validate appointment time is within business hours (7:00 to 17:00)
  const [hour, minute] = time_slot.split(":").map(Number);
  if (hour < 7 || hour > 17 || (hour === 17 && minute > 0)) {
    return res.status(400).send("Appointment time must be within business hours (7:00–17:00).");
  }

  // Define valid time slots for booking
  const validTimeSlots = [
    "08:00", "09:00", "10:00", "11:00",
    "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"
  ];

  // Check if the selected time slot is allowed
  if (!validTimeSlots.includes(time_slot)) {
    return res.status(400).send("Invalid time slot selected.");
  }

  // Check if the appointment date is a public holiday (bookings not allowed)
  const formattedDate = appointment_date.split("T")[0]; // Extract only YYYY-MM-DD part
  if (publicHolidays.includes(formattedDate)) {
    return res.status(400).send("Bookings cannot be made on public holidays.");
  }

  // Query database to count existing bookings on same date/time/location
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

  // Limit bookings to max 2 per time slot and location to avoid overbooking
  if (bookingCount >= 2) {
    return res.status(409).send("This time slot and location already has two bookings. Please choose another.");
  }

  try {
    // Use serialize to ensure sequential execution of DB queries and inserts
    db2.serialize(() => {
      // Step 1: Check if user exists by email or phone number
      db2.get(`
        SELECT * FROM user WHERE EmailAddress = ? OR PhoneNumber = ?
      `, [email_address, contact_number], async (err, user) => {
        if (err) return res.status(500).send("Database error (user lookup).");

        let userId;

        if (!user) {
          // User does not exist - create new user with a generated default password
          const rawPassword = `${first_name}-${last_name}-${contact_number}-${Date.now()}`;
          const hashedPassword = await bcrypt.hash(rawPassword, 10);  // Hash password for security
          console.log(`Default password for ${first_name} ${last_name}: ${rawPassword}`);

          // Insert new user into database
          db2.run(`
            INSERT INTO user (FirstName, LastName, Password, PhoneNumber, EmailAddress, UserType)
            VALUES (?, ?, ?, ?, ?, 'CUSTOMER')
          `, [first_name, last_name, hashedPassword, contact_number, email_address], function (err) {
            if (err) return res.status(500).send("Failed to create user.");
            userId = this.lastID;  // Get the new user's ID
            checkVehicle(userId);   // Proceed to check vehicle ownership
          });
        } else {
          // User exists, get their ID
          userId = user.UserID;
          checkVehicle(userId);   // Proceed to check vehicle ownership
        }

        // Function to verify if vehicle exists and belongs to this user
        function checkVehicle(userId) {
          db2.get(`
            SELECT * FROM vehicle WHERE Registration = ?
          `, [registration], (err, vehicle) => {
            if (err) return res.status(500).send("Database error (vehicle check).");

            if (!vehicle) return res.status(404).send("Vehicle not registered.");

            // Check if the vehicle belongs to the user
            if (vehicle.UserID !== userId) return res.status(403).send("Vehicle does not belong to this user.");

            // Proceed with booking the appointment
            proceedWithAppointment(userId);

            // Send confirmation email to user with appointment details
            transporter.sendMail({
              from: process.env.EMAIL_USER,
              to: email_address,
              subject: 'AMW Servicing Appointment Confirmation',
              text: `
Hi ${first_name},

Your servicing appointment has been confirmed with the following details:

- Date: ${appointment_date}
- Time: ${time_slot}
- Location: ${location}
- Vehicle: ${registration}
- Service Type: ${service_type}
- Specific Service: ${specific_service}
- Odometer Reading: ${odometer_km} km
- Logbook Interval: ${logbook_interval}
${clean_type ? `- Additional Cleaning: ${clean_type}` : ''}

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

        // Function to create appointment and associated service/cleaning records
        function proceedWithAppointment(userId) {
          // Insert new appointment record with status 'SCHEDULED'
          db2.run(`
            INSERT INTO appointment (UserID, Registration, AppointmentDate, TimeSlot, Location, AppointmentStatus)
            VALUES (?, ?, ?, ?, ?, 'SCHEDULED')
          `, [userId, registration, appointment_date, time_slot, location], function (err) {
            if (err) return res.status(500).send("Failed to create appointment.");

            const appointmentId = this.lastID;  // Get appointment ID

            // Insert service details for this appointment
            db2.run(`
              INSERT INTO service (AppointmentID, Registration, OdometerKM, LogbookInterval, ServiceType, SpecificService)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [appointmentId, registration, odometer_km, logbook_interval, service_type, specific_service], (err) => {
              if (err) return res.status(500).send("Failed to log servicing task.");

              // If cleaning requested, insert cleaning record too
              if (clean_type) {
                db2.run(`
                  INSERT INTO clean (AppointmentID, Registration, CleanType)
                  VALUES (?, ?, ?)
                `, [appointmentId, registration, clean_type], (err) => {
                  if (err) return res.status(500).send("Failed to log cleaning task.");
                  return res.send("Service + Cleaning appointment booked successfully!");
                });
              } else {
                return res.send("Service appointment booked successfully!");
              }
            });
          });
        }
      });
    });
  } catch (err) {
    // Catch-all error handler for unexpected server errors
    console.error("Server error:", err);
    res.status(500).send("Server error during booking.");
  }
});

module.exports = router;  // Export the router to be used in app.js or main server file
