import express from 'express';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
app.use(express.json());

// Basic health check route
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running!' });
});

// Basic root route
app.get('/', (req, res) => {
    res.json({ message: 'Outbound Call System API' });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
