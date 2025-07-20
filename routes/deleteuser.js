const express = require('express');
const router = express.Router();
const db2 = require('../db2'); // Database connection/module

// Middleware to check if user is authenticated (logged in)
const requireAuth = (req, res, next) => {
  // If session or user info missing, redirect to login page
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next(); // User is authenticated, proceed
};

// Middleware factory for role-based access control
// Takes allowed roles as arguments and returns middleware function
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    // If no user session or user role is not in allowedRoles, deny access
    if (!req.session.user || !allowedRoles.includes(req.session.user.role)) {
      return res.status(403).send('Access denied.');
    }
    next(); // Role is allowed, proceed
  };
}

// GET route to render the delete user page
// Only accessible by authenticated users with ADMIN role
router.get('/', requireAuth, requireRole('ADMIN'), (req, res) => {
  // Render 'deleteuser' view template
  // Pass success and error messages via query parameters for display
  res.render('deleteuser', { success: req.query.success, error: req.query.error });
});

// POST route to handle deletion of a user
// Only accessible by authenticated ADMIN users
router.post('/', requireAuth, requireRole('ADMIN'), (req, res) => {
  // Get userId from form submission (body)
  const userId = req.body.userId;
  // Parse userId as an integer
  const userIdParsed = parseInt(req.body.userId, 10);
  const currentId = req.session.user.id

   // Prevent deletion of current user (UserID = 1)
  if (userIdParsed === currentId) {
    return res.redirect('/deleteuser?error=Cannot delete current user');
  }

  // Prevent deletion of root user (UserID = 1) as a safeguard
  if (userIdParsed === 1) {
    return res.redirect('/deleteuser?error=Cannot delete root user');
  }

  // Run SQL DELETE query to remove user with given UserID
  db2.run('DELETE FROM user WHERE UserID = ?', [userId], function(err) {
    if (err) {
      // Log the error and redirect with error message
      console.error('Delete user error:', err.message);
      return res.redirect('/deleteuser?error=Unable to delete user');
    }
    // If no rows were affected, user was not found
    if (this.changes === 0) {
      return res.redirect('/deleteuser?error=User not found');
    }
    // Successful deletion - redirect with success message
    res.redirect('/deleteuser?success=User deleted successfully');
  });
});

// Export router to use in main app
module.exports = router;
