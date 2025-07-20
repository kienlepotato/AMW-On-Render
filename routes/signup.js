const express = require('express');          // Import Express framework
const db2 = require('../db2');                // Import SQLite database connection
const bcrypt = require('bcrypt');             // Import bcrypt for password hashing
const router = express.Router();              // Create a new Express router instance

// Regular expression to validate phone numbers (digits, spaces, dashes, optional leading +)
const phoneRegex = /^[+]?[\d\s\-]{7,15}$/;

// POST route to handle user registration
router.post('/', (req, res) => {
  // Extract user registration details from the request body
  const { firstName, lastName, phone, email, password, confirmPassword } = req.body;

  // Basic validation: check if all required fields are present and passwords match
  if (!firstName || !lastName || !phone || !email || !password || password !== confirmPassword) {
    return res.status(400).send("Please fill all fields correctly.");
  }

  // Validate phone number format using regex
  if (!phoneRegex.test(phone)) {
    return res.status(400).send("Invalid phone number format.");
  }

  // Start a serialized DB operation (ensures queries run sequentially)
  db2.serialize(() => {
    // Check if a user with the same email or phone number already exists
    db2.get(`
      SELECT * FROM user WHERE EmailAddress = ? OR PhoneNumber = ?
    `, [email, phone], async (err, user) => {
      if (err) {
        console.error("Error checking user:", err);
        return res.status(500).send("Database error.");
      }

      // If user exists, reject registration
      if (user) {
        return res.status(400).send("Email or phone number already in use.");
      }

      try {
        // Hash the user's password securely before storing
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new user record into the database with role CUSTOMER
        db2.run(`
          INSERT INTO user (FirstName, LastName, Password, PhoneNumber, EmailAddress, UserType)
          VALUES (?, ?, ?, ?, ?, 'CUSTOMER')
        `, [firstName, lastName, hashedPassword, phone, email], function (err) {
          if (err) {
            console.error("Error inserting user:", err);
            return res.status(500).send("Failed to create user.");
          }

          // On success, redirect user to login page
          return res.redirect('/login');
        });
      } catch (hashErr) {
        // Handle any errors that occur during password hashing
        console.error("Password hashing failed:", hashErr);
        res.status(500).send("Internal server error.");
      }
    });
  });
});

module.exports = router;    // Export the router to be used in main app
