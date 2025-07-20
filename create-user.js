// Old Version (commented out):
// const bcrypt = require('bcrypt'); // Import bcrypt for password hashing
// const sqlite3 = require('sqlite3').verbose(); // Enable verbose logging for SQLite
// const db = new sqlite3.Database('./amw.db'); // Connect to the SQLite database

// const username = 'user';
// const password = 'password';
// const role = 'user';

// // Hash the password and insert the user into the database
// bcrypt.hash(password, 10).then(hash => {
//   db.run(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`,
//     [username, hash, role],
//     () => {
//       console.log('User created');
//       db.close(); // Close the database connection
//     });
// });


// -----------------------------
// New Version (Active):
// -----------------------------

const bcrypt = require('bcrypt'); // Import bcrypt for hashing passwords securely
const sqlite3 = require('sqlite3').verbose(); // Use SQLite with verbose logging
const db = new sqlite3.Database('./amw.db'); // Open connection to local SQLite database file

// Define a new user to be inserted into the database
const newUser = {
  firstname: 'Root',                     // User's first name
  lastname: '',                          // Last name (empty string in this case)
  password: 'Passw0rd!',                 // Plaintext password to be hashed
  phoneNumber: '046931130',              // User's phone number
  emailAddress: 'kien.leaus+root@gmail.com', // Email address
  userType: 'ADMIN'                      // User role/type
};

// Hash the password and insert the user into the database
bcrypt.hash(newUser.password, 10).then(hash => {
  db.run(
    `INSERT INTO user (
      FirstName, LastName, Password, PhoneNumber, EmailAddress, UserType
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      newUser.firstname,
      newUser.lastname,
      hash,                      // Use hashed password for security
      newUser.phoneNumber,
      newUser.emailAddress,
      newUser.userType
    ],
    function (err) {
      if (err) {
        // Log error if insertion fails
        console.error('Error inserting user:', err.message);
      } else {
        // Log the ID of the newly created user
        console.log('User created with ID:', this.lastID);
      }
      db.close(); // Always close the database connection
    }
  );
});
