const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const db = new Database(path.join(__dirname, 'flights.db'));
db.pragma('journal_mode = WAL');

db.prepare(`
  CREATE TABLE IF NOT EXISTS airports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS flights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    departure_airport_id INTEGER NOT NULL,
    arrival_airport_id INTEGER NOT NULL,
    departure_time TEXT NOT NULL,
    arrival_time TEXT NOT NULL,
    cost REAL NOT NULL,
    duration TEXT NOT NULL,
    FOREIGN KEY (departure_airport_id) REFERENCES airports (id),
    FOREIGN KEY (arrival_airport_id) REFERENCES airports (id)
  )
`).run();

const insertAirport = db.prepare('INSERT OR IGNORE INTO airports (name, code) VALUES (?, ?)');
insertAirport.run('Budapest Liszt Ferenc', 'BUD');
insertAirport.run('London Heathrow', 'LHR');
insertAirport.run('Frankfurt am Main', 'FRA');
insertAirport.run('Amsterdam Schiphol', 'AMS');
insertAirport.run('Paris Charles de Gaulle', 'CDG');

const flightCount = db.prepare('SELECT COUNT(*) AS count FROM flights').get().count;
if (flightCount === 0) {
  const insertFlight = db.prepare(`
    INSERT INTO flights
      (departure_airport_id, arrival_airport_id, departure_time, arrival_time, cost, duration)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertFlight.run(1, 2, '2026-06-01T09:00', '2026-06-01T11:00', 120, '2h 0m');
  insertFlight.run(1, 3, '2026-06-01T12:30', '2026-06-01T14:15', 95, '1h 45m');
  insertFlight.run(2, 4, '2026-06-02T08:00', '2026-06-02T10:20', 140, '2h 20m');
  insertFlight.run(3, 5, '2026-06-03T15:10', '2026-06-03T17:40', 110, '2h 30m');
}

function mapFlightRow(row) {
  return {
    id: row.id,
    departureAirportId: row.departureAirportId,
    departureAirport: row.departureAirport,
    departureAirportCode: row.departureAirportCode,
    arrivalAirportId: row.arrivalAirportId,
    arrivalAirport: row.arrivalAirport,
    arrivalAirportCode: row.arrivalAirportCode,
    departureTime: row.departureTime,
    arrivalTime: row.arrivalTime,
    cost: row.cost,
    duration: row.duration
  };
}

app.get('/api/airports', (req, res) => {
  const airports = db.prepare('SELECT id, name, code FROM airports ORDER BY name ASC').all();
  res.json(airports);
});

app.get('/api/flights', (req, res) => {
  const departureAirportId = parseInt(req.query.departureAirportId, 10);
  let statement = db.prepare(`
    SELECT
      f.id,
      da.id AS departureAirportId,
      da.name AS departureAirport,
      da.code AS departureAirportCode,
      aa.id AS arrivalAirportId,
      aa.name AS arrivalAirport,
      aa.code AS arrivalAirportCode,
      f.departure_time AS departureTime,
      f.arrival_time AS arrivalTime,
      f.cost,
      f.duration
    FROM flights f
    JOIN airports da ON f.departure_airport_id = da.id
    JOIN airports aa ON f.arrival_airport_id = aa.id
    ${Number.isInteger(departureAirportId) ? 'WHERE f.departure_airport_id = ?' : ''}
    ORDER BY f.departure_time ASC
  `);

  const flights = Number.isInteger(departureAirportId)
    ? statement.all(departureAirportId)
    : statement.all();

  res.json(flights.map(mapFlightRow));
});

app.post('/api/flights', (req, res) => {
  const {
    departureAirportId,
    arrivalAirportId,
    departureTime,
    arrivalTime,
    cost,
    duration
  } = req.body;

  if (!departureAirportId || !arrivalAirportId || !departureTime || !arrivalTime || cost == null || !duration) {
    return res.status(400).json({ error: 'Minden mező kitöltése kötelező.' });
  }

  if (departureAirportId === arrivalAirportId) {
    return res.status(400).json({ error: 'Az indulási és érkezési reptér nem lehet ugyanaz.' });
  }

  const insert = db.prepare(`
    INSERT INTO flights
      (departure_airport_id, arrival_airport_id, departure_time, arrival_time, cost, duration)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(departureAirportId, arrivalAirportId, departureTime, arrivalTime, cost, duration);
  const flight = db.prepare('SELECT * FROM flights WHERE id = ?').get(result.lastInsertRowid);

  const row = db.prepare(`
    SELECT
      f.id,
      da.id AS departureAirportId,
      da.name AS departureAirport,
      da.code AS departureAirportCode,
      aa.id AS arrivalAirportId,
      aa.name AS arrivalAirport,
      aa.code AS arrivalAirportCode,
      f.departure_time AS departureTime,
      f.arrival_time AS arrivalTime,
      f.cost,
      f.duration
    FROM flights f
    JOIN airports da ON f.departure_airport_id = da.id
    JOIN airports aa ON f.arrival_airport_id = aa.id
    WHERE f.id = ?
  `).get(flight.id);

  res.status(201).json(mapFlightRow(row));
});

app.put('/api/flights/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const {
    departureAirportId,
    arrivalAirportId,
    departureTime,
    arrivalTime,
    cost,
    duration
  } = req.body;

  const existing = db.prepare('SELECT * FROM flights WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'A járat nem található.' });
  }

  if (!departureAirportId || !arrivalAirportId || !departureTime || !arrivalTime || cost == null || !duration) {
    return res.status(400).json({ error: 'Minden mező kitöltése kötelező.' });
  }

  if (departureAirportId === arrivalAirportId) {
    return res.status(400).json({ error: 'Az indulási és érkezési reptér nem lehet ugyanaz.' });
  }

  db.prepare(`
    UPDATE flights SET
      departure_airport_id = ?,
      arrival_airport_id = ?,
      departure_time = ?,
      arrival_time = ?,
      cost = ?,
      duration = ?
    WHERE id = ?
  `).run(departureAirportId, arrivalAirportId, departureTime, arrivalTime, cost, duration, id);

  const row = db.prepare(`
    SELECT
      f.id,
      da.id AS departureAirportId,
      da.name AS departureAirport,
      da.code AS departureAirportCode,
      aa.id AS arrivalAirportId,
      aa.name AS arrivalAirport,
      aa.code AS arrivalAirportCode,
      f.departure_time AS departureTime,
      f.arrival_time AS arrivalTime,
      f.cost,
      f.duration
    FROM flights f
    JOIN airports da ON f.departure_airport_id = da.id
    JOIN airports aa ON f.arrival_airport_id = aa.id
    WHERE f.id = ?
  `).get(id);

  res.json(mapFlightRow(row));
});

app.delete('/api/flights/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = db.prepare('DELETE FROM flights WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'A járat nem található.' });
  }
  res.status(204).send();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Repülőjárat rendszer fut: http://localhost:${port}`);
});
