// Import sqlite3 and enable verbose logging for easier debugging
const sqlite3 = require('sqlite3').verbose();

// Connect to the SQLite database file 'amw.db'
// If the file doesn't exist, it will be created
const db = new sqlite3.Database('./amw.db');

// Begin serialized execution of SQL commands to ensure order
db.serialize(() => {

  // Enable foreign key constraints in SQLite (off by default)
  db.run('PRAGMA foreign_keys = ON');

  // ─────────────────────────────────────────────────────────────────────────────
  // Create `user` table to store system users like customers, mechanics, admins
  // ─────────────────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS user (
      UserID INTEGER PRIMARY KEY AUTOINCREMENT,  -- Unique identifier for each user
      FirstName TEXT NOT NULL,                   -- First name of the user
      LastName TEXT NOT NULL,                    -- Last name of the user
      Password TEXT NOT NULL,                    -- Hashed password
      PhoneNumber TEXT NOT NULL UNIQUE,          -- Unique phone number
      EmailAddress TEXT NOT NULL UNIQUE,         -- Unique email address
      UserType TEXT NOT NULL                     -- Role: CUSTOMER, MECHANIC, ADMIN
    );
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // Create `vehicle` table to store vehicles linked to users
  // ─────────────────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS vehicle (
      Registration TEXT PRIMARY KEY,             -- Unique vehicle registration
      UserID INTEGER NOT NULL,                   -- Foreign key to user table
      Make TEXT NOT NULL,                        -- Car make (e.g., Toyota)
      Model TEXT NOT NULL,                       -- Car model (e.g., Corolla)
      Year INTEGER NOT NULL,                     -- Year of manufacture
      Colour TEXT NOT NULL,                      -- Color of the vehicle
      LastServiceDate TEXT NOT NULL,             -- Last service date
      FOREIGN KEY (UserID) REFERENCES user(UserID) ON DELETE CASCADE
    );
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // Create `appointment` table to store service bookings
  // ─────────────────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS appointment (
      AppointmentID INTEGER PRIMARY KEY AUTOINCREMENT, -- Unique ID
      UserID INTEGER NOT NULL,                         -- Customer ID
      Registration TEXT NOT NULL,                      -- Vehicle registration
      AppointmentDate TEXT NOT NULL,                   -- Date of appointment
      TimeSlot TEXT NOT NULL,                          -- Time slot (e.g., 10:00-11:00)
      Location TEXT NOT NULL,                          -- Service location
      AppointmentStatus TEXT NOT NULL,                 -- SCHEDULED, INPROGRESS, COMPLETE
      MechanicAssigned INTEGER,                        -- Optional: mechanic user ID
      FOREIGN KEY (UserID) REFERENCES user(UserID) ON DELETE CASCADE
    );
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // Create `clean` table to store cleaning services for vehicles
  // ─────────────────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS clean (
      CleanID INTEGER PRIMARY KEY AUTOINCREMENT,       -- Unique ID
      AppointmentID INTEGER NOT NULL,                  -- Related appointment
      Registration TEXT NOT NULL,                      -- Vehicle registration
      CleanType TEXT NOT NULL,                         -- Type of clean (e.g., interior, full)
      FOREIGN KEY (AppointmentID) REFERENCES appointment(AppointmentID) ON DELETE CASCADE,
      FOREIGN KEY (Registration) REFERENCES vehicle(Registration) ON DELETE CASCADE
    );
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // Create `repair` table to track repairs done on vehicles
  // ─────────────────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS repair (
      RepairID INTEGER PRIMARY KEY AUTOINCREMENT,      -- Unique ID
      AppointmentID INTEGER NOT NULL,                  -- Related appointment
      Registration TEXT NOT NULL,                      -- Vehicle registration
      RepairType TEXT NOT NULL,                        -- SCHEDULED, INPROGRESS, COMPLETE
      SpecificRepairs TEXT,                            -- Description of repairs
      FOREIGN KEY (AppointmentID) REFERENCES appointment(AppointmentID) ON DELETE CASCADE,
      FOREIGN KEY (Registration) REFERENCES vehicle(Registration) ON DELETE CASCADE
    );
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // Create `service` table to store general/essential/specific servicing records
  // ─────────────────────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS service (
      ServicingID INTEGER PRIMARY KEY AUTOINCREMENT,   -- Unique ID
      AppointmentID INTEGER NOT NULL,                  -- Related appointment
      Registration TEXT NOT NULL,                      -- Vehicle registration
      OdometerKM INTEGER NOT NULL,                     -- Odometer reading at service time
      LogbookInterval INTEGER NOT NULL,                -- Logbook interval (e.g., 10,000 km)
      ServiceType TEXT NOT NULL,                       -- GENERAL, ESSENTIAL, SPECIFIC
      SpecificService TEXT NOT NULL,                   -- e.g., OIL&FILTER, BRAKE&CLUTCH
      FOREIGN KEY (AppointmentID) REFERENCES appointment(AppointmentID) ON DELETE CASCADE,
      FOREIGN KEY (Registration) REFERENCES vehicle(Registration) ON DELETE CASCADE
    );
  `);

  // ─────────────────────────────────────────────────────────────────────────────
  // You can uncomment and modify the following template to create other tables
  // ─────────────────────────────────────────────────────────────────────────────
  /*
  db.run(`
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      customer_name VARCHAR(100),
      contact_number VARCHAR(15),
      service_type VARCHAR(50),
      appointment_date DATE,
      time_slot VARCHAR(20),
      location VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  */
});

// Export the database connection for use in other modules
module.exports = db;
