import express from 'express';
import axios from 'axios';
import { checkAvailability } from './tools/calendarTool.js';

const router = express.Router();

router.post('/checkAvailability', async (req, res) => {
    const { firstName, lastName, phoneNumber } = req.body;
    const result = await checkAvailability(firstName, lastName, phoneNumber);
    res.json(result);
});

// Add new setAppointment endpoint
router.post('/setAppointment', async (req, res) => {
    const { startTime, phoneNumber, callId } = req.body;
    
    console.log('Setting appointment:', { startTime, phoneNumber, callId });
    
    try {
        // Send to Make.com webhook
        const response = await axios.post(
            process.env.MAKE_WEBHOOK_URL,
            {
                startTime,
                phoneNumber,
                callId,
                action: 'setAppointment'
            }
        );

        // Return the Make.com response to the AI
        return res.json({
            success: true,
            result: response.data.result || 'Appointment set successfully',
            appointmentDetails: {
                startTime,
                phoneNumber
            }
        });

    } catch (error) {
        console.error('Failed to set appointment:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to set appointment',
            details: error.message
        });
    }
});

export { router }; 