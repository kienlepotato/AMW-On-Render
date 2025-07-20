// Import required modules
const express = require('express');
const bcrypt = require('bcrypt'); // For password hashing
const router = express.Router(); // Create a new router instance
const db = require('../db2'); // Import database connection

// Regular expression to validate phone numbers
const phoneRegex = /^[+]?[\d\s\-]{7,15}$/;

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    // Redirect to login if user is not logged in
    return res.redirect('/login');
  }
  next(); // Proceed to the next middleware or route handler
};

// Middleware to restrict access based on user role
function requireRole(role) {
  return function (req, res, next) {
    // Check if the logged-in user's role matches the required role
    if (!req.session.user || req.session.user.role !== role) {
      // Deny access if roles don't match
      return res.status(403).send('Access denied.');
    }
    next(); // Proceed if role matches
  };
}

// Route: GET /adduser
// Description: Render the Add User form (only for ADMIN users)
router.get('/', requireAuth, requireRole('ADMIN'), (req, res) => {
  res.render('adduser', {
    success: req.query.success || null, // Show success message if redirected with ?success=1
    error: null, // No error by default
    user: req.session.user // Pass current user info to the view
  });
});

// Route: POST /adduser
// Description: Process the Add User form submission
router.post('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  // Extract form data from the request body
  const { firstname, lastname, password, phoneNumber, emailAddress, userType } = req.body;

  // Validate phone number format
  if (!phoneRegex.test(phoneNumber)) {
    return res.render('adduser', {
      error: 'Invalid phone number format.', // Show error in view
      success: null,
      user: req.session.user
    });
  }

  try {
    // Hash the password before storing it
    const hash = await bcrypt.hash(password, 10);

    // SQL statement to insert new user into the database
    const sql = `
      INSERT INTO user (FirstName, LastName, Password, PhoneNumber, EmailAddress, UserType)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    // Execute the insert query
    db.run(sql, [firstname, lastname, hash, phoneNumber, emailAddress, userType], function (err) {
      if (err) {
        console.error(err.message); // Log any error to the console
        return res.render('adduser', {
          error: 'Failed to create user. Email might already be in use.', // Show error to user
          success: null,
          user: req.session.user
        });
      }

      // Redirect to the form again with a success flag
      res.redirect('/adduser?success=1');
    });
  } catch (err) {
    // Catch and handle unexpected errors
    console.error(err);
    res.render('adduser', {
      error: 'Internal error. Please try again later.', // Show general error
      success: null,
      user: req.session.user
    });
  }
});

// Export the router so it can be used in other parts of the app
module.exports = router;
