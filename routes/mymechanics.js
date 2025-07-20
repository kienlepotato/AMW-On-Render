// Import required modules
const express = require('express');
const router = express.Router();
const db2 = require('../db2'); // Database connection

// ------------------------
// Authentication Middleware
// ------------------------

// Ensures the user is logged in
const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login'); // Redirect unauthenticated users to login
  }
  next();
};

// ------------------------
// Role-Based Access Control Middleware
// ------------------------

// Allows access only to users with specific roles
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    // Check if user is logged in and their role is allowed
    if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
      return res.status(403).send('Access denied.');
    }
    next();
  };
}

// ------------------------
// GET: View Users by Role (Mechanics, Supervisors, Admins)
// ------------------------

// Route only accessible by ADMIN, MECHANIC, or SUPERVISOR
router.get('/', requireAuth, requireRole('ADMIN', 'MECHANIC', 'SUPERVISOR'), (req, res) => {
  // Fetch all mechanics from the database
  db2.all(
    `SELECT UserID, FirstName, LastName, PhoneNumber, EmailAddress FROM user WHERE UserType = 'MECHANIC'`,
    [],
    (err, mechanics) => {
      if (err) {
        console.error(err);
        res.redirect(`/myappointments?error=Error Fetching Mechanics`);
      }

      // Fetch all supervisors
      db2.all(
        `SELECT UserID, FirstName, LastName, PhoneNumber, EmailAddress FROM user WHERE UserType = 'SUPERVISOR'`,
        [],
        (err2, supervisors) => {
          if (err2) {
            console.error(err2);
            res.redirect(`/myappointments?error=Error Fetching Supervisors`);
          }

          // Fetch all admins
          db2.all(
            `SELECT UserID, FirstName, LastName, PhoneNumber, EmailAddress FROM user WHERE UserType = 'ADMIN'`,
            [],
            (err3, admins) => {
              if (err3) {
                console.error(err3);
                res.redirect(`/myappointments?error=Error Fetching Admins`);
              }

              // Render the page with the retrieved user lists
              res.render('mymechanics', {
                user: req.session.user, // current logged-in user
                mechanics,              // list of mechanics
                supervisors,            // list of supervisors
                admins                  // list of admins
              });
            }
          );
        }
      );
    }
  );
});

// Export the router so it can be used in the main app
module.exports = router;
