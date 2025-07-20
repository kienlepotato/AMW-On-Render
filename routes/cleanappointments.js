const express = require('express');
const db2 = require('../db2'); // SQLite database connection
const bcrypt = require('bcrypt'); // For password hashing
const router = express.Router();
const path = require('path');
const publicHolidays = require('../publicHolidays.json'); // JSON file with public holiday dates
const nodemailer = require('nodemailer');
require('dotenv').config(); // Loads environment variables from .env file

// Configure email transporter for Gmail using environment variables
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Regex pattern to validate phone numbers
const phoneRegex = /^[+]?[\d\s\-]{7,15}$/;

// POST endpoint to handle new cleaning appointment bookings
router.post('/', async (req, res) => {
  const {
    first_name, last_name, contact_number, registration,
    email_address, clean_type, appointment_date,
    time_slot, location
  } = req.body;

  const appointmentDate = new Date(appointment_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to midnight for date comparison

  // Validate phone number format
  if (!phoneRegex.test(contact_number)) {
    return res.status(400).send("Invalid contact number.");
  }

  // Ensure appointment date is not in the past
  if (appointmentDate < today) {
    return res.status(400).send("Appointment date must be in the future.");
  }

  // Validate time is within operating hours (7:00–17:00)
  const [hour, minute] = time_slot.split(":").map(Number);
  if (hour < 7 || hour > 17 || (hour === 17 && minute > 0)) {
    return res.status(400).send("Appointment time must be within business hours (7:00–17:00).");
  }

  // Acceptable time slots (can expand if needed)
  const validTimeSlots = [
    "08:00", "09:00", "10:00", "11:00",
    "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", 
    "08:30", "09:30", "10:30", "11:30",
    "12:30", "13:30", "14:30", "15:30", "16:30", "17:30"
  ];
  if (!validTimeSlots.includes(time_slot)) {
    return res.status(400).send("Invalid time slot selected.");
  }

  // Disallow bookings on public holidays
  const formattedDate = appointment_date.split("T")[0];
  if (publicHolidays.includes(formattedDate)) {
    return res.status(400).send("Bookings cannot be made on public holidays.");
  }

  // Limit to 2 appointments per location/time to prevent overbooking
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

  if (bookingCount >= 2) {
    return res.status(409).send("This time slot and location already has two bookings. Please choose another.");
  }

  try {
    db2.serialize(() => {
      // Check if the user already exists based on email or phone number
      db2.get(`
        SELECT * FROM user WHERE EmailAddress = ? OR PhoneNumber = ?
      `, [email_address, contact_number], async (err, user) => {
        if (err) {
          console.error("Error checking user:", err);
          return res.status(500).send("Database error.");
        }

        let userId;

        if (!user) {
          // Create new user with generated password if not found
          const rawPassword = `${first_name}-${last_name} -${contact_number}-${email_address}-${Date.now()}`;
          const hashedPassword = await bcrypt.hash(rawPassword, 10);
          console.log(`default password of ${first_name} ${last_name}: ${rawPassword}`);

          db2.run(`
            INSERT INTO user (FirstName, LastName, Password, PhoneNumber, EmailAddress, UserType)
            VALUES (?, ?, ?, ?, ?, 'CUSTOMER')
          `, [first_name, last_name, hashedPassword, contact_number, email_address], function (err) {
            if (err) {
              console.error("Error inserting user:", err);
              return res.status(500).send("Failed to create user.");
            }

            userId = this.lastID;
            checkVehicleAndProceed(userId);
          });
        } else {
          // Existing user found
          userId = user.UserID;
          checkVehicleAndProceed(userId);
        }

        // Step to ensure the vehicle exists and is linked to the user
        function checkVehicleAndProceed(userId) {
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

            // All checks passed, proceed to insert the appointment
            proceedWithAppointment(userId);
          });
        }

        // Insert appointment and cleaning service
        function proceedWithAppointment(userId) {
          db2.run(`
            INSERT INTO appointment (UserID, Registration, AppointmentDate, TimeSlot, Location, AppointmentStatus)
            VALUES (?, ?, ?, ?, ?, 'SCHEDULED')
          `, [userId, registration, appointment_date, time_slot, location], function (err) {
            if (err) {
              console.error("Error inserting appointment:", err);
              return res.status(500).send("Failed to create appointment.");
            }

            const appointmentId = this.lastID;

            // Insert corresponding cleaning task
            db2.run(`
              INSERT INTO clean (AppointmentID, Registration, CleanType)
              VALUES (?, ?, ?)
            `, [appointmentId, registration, clean_type], (err) => {
              if (err) {
                console.error("Error inserting clean:", err);
                return res.status(500).send("Failed to log cleaning task.");
              }

              // Send email confirmation to the user
              transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: email_address,
                subject: 'AMW Cleaning Appointment Confirmation',
                text: `
Hi ${first_name},

Your cleaning appointment has been confirmed with the following details:

- Date: ${appointment_date}
- Time: ${time_slot}
- Location: ${location}
- Vehicle: ${registration}
- Clean Type: ${clean_type}

Thank you for booking with AMW!

Regards,  
AMW Team
                `
              }, (error, info) => {
                if (error) {
                  console.error("Error sending email:", error);
                  return res.status(500).send("Appointment booked, but failed to send confirmation email.");
                }
                console.log("Confirmation email sent:", info.response);
                return res.send("Appointment booked successfully! A confirmation email has been sent.");
              });
            });
          });
        }
      });
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).send('Error booking appointment');
  }
});

// GET route to render the cleaning appointment booking page
router.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const userId = req.session.user.UserID;

  // Fetch user's vehicles to show in the form
  db2.all(
    `SELECT Registration, Make, Model, Year FROM vehicle WHERE UserID = ?`,
    [userId],
    (err, vehicles) => {
      if (err) {
        console.error("Error fetching vehicles:", err);
        return res.status(500).send("Database error");
      }

      res.render('bookclean', {
        user: req.session.user,
        vehicles: vehicles
      });
    }
  );
});

module.exports = router;
