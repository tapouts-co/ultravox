import dotenv from 'dotenv';
import twilio from 'twilio';
import https from 'https';
import express from 'express';
import axios from 'axios';
import fs from 'fs/promises';
import { handleCallStatus, storeCallData } from './callStatusHandler.js';
import { getUltravoxConfig } from './ultravoxConfig.js';
import { router as calRouter } from './cal.js';

// Load environment variables
dotenv.config();

// Debug logging for environment variables
console.log('Environment variables loaded:');
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID ? 'Found' : 'Missing');
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'Found' : 'Missing');
console.log('TWILIO_PHONE_NUMBER:', process.env.TWILIO_PHONE_NUMBER ? 'Found' : 'Missing');

// Create Express app
const app = express();
app.use(express.json());  // For parsing application/json
app.use(express.urlencoded({ extended: true }));  // For parsing application/x-www-form-urlencoded

// Serve static files
app.use(express.static('public'));

// Serve the prompt manager at root
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: './public' });
});

// Constants
const ULTRAVOX_API_KEY = process.env.ULTRAVOX_API_KEY;
const ULTRAVOX_API_URL = process.env.ULTRAVOX_API_URL;
const PROMPT_FILE = './prompt.json';

// Default prompt
const defaultPrompt = `You are Steve, a professional and friendly caller. The current time is: {currentDateTime}

Your main tasks are:

1. Introduce yourself and confirm you're speaking with the right person
2. Explain the reason for your call using the provided details
3. If the conversation involves scheduling:
   - First use checkAvailability to find suitable times
   - Present the options clearly to the caller
   - Once the caller confirms a time, use setAppointment to book it
4. Be polite and professional throughout the call

When checking availability:
- Get the person's first name
- Use the checkAvailability tool to find available slots
- Present the options clearly to the caller
- When responding to the caller about availabilities use human like language
- If the caller needs slots beyond the next 5 days, politely explain that you can only see availability for the next 5 days

When setting an appointment:
- Use the setAppointment tool with the exact time slot the caller chose
- The tool will return a result message that you should relay to the caller
- If successful, confirm all appointment details
- If failed, apologize and offer to check other times

When the conversation naturally concludes, use the 'hangUp' tool to end the call.`;

// Prompt management
async function getPrompt() {
    try {
        const data = await fs.readFile(PROMPT_FILE, 'utf8');
        return JSON.parse(data).prompt;
    } catch (error) {
        console.log('Using default prompt');
        return defaultPrompt;
    }
}

// API endpoints
app.get('/api/prompt', async (req, res) => {
    try {
        const prompt = await getPrompt();
        console.log('Serving prompt:', prompt);
        res.json({ prompt });
    } catch (error) {
        console.error('Error serving prompt:', error);
        res.json({ prompt: defaultPrompt });
    }
});

app.post('/api/prompt', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ 
            success: false, 
            error: 'Prompt is required' 
        });
    }
    
    // Add validation to prevent inappropriate content
    if (prompt.length < 100) {  // Basic length check
        return res.status(400).json({
            success: false,
            error: 'Prompt is too short. Please provide a complete prompt.'
        });
    }

    // Always include the essential parts
    const essentialPrompt = `You are Steve, a professional and friendly caller. The current time is: {currentDateTime}

Your main tasks are:
1. Introduce yourself and confirm you're speaking with the right person
2. Explain the reason for your call using the provided details
3. If the conversation involves scheduling:
   - First use checkAvailability to find suitable times
   - Present the options clearly to the caller
   - Once the caller confirms a time, use setAppointment to book it
4. Be polite and professional throughout the call`;

    // Ensure the prompt contains essential parts
    const finalPrompt = prompt.includes('You are Steve') ? prompt : essentialPrompt + '\n\n' + prompt;
    
    try {
        await fs.writeFile(PROMPT_FILE, JSON.stringify({ prompt: finalPrompt }, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving prompt:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to save prompt',
            details: error.message 
        });
    }
});

// Main call function
async function createUltravoxCall(variables) {
    const ULTRAVOX_CALL_CONFIG = await getUltravoxConfig();
    
    // Get prompt and add current time
    const basePrompt = await getPrompt();
    console.log('Loaded prompt for call:', basePrompt);
    const currentDateTime = new Date().toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
    });

    // Replace variables
    let finalPrompt = basePrompt.replace('{currentDateTime}', currentDateTime);
    Object.entries(variables).forEach(([key, value]) => {
        finalPrompt = finalPrompt.replace(`{${key}}`, value || `[no ${key} provided]`);
    });

    const callConfig = {
        ...ULTRAVOX_CALL_CONFIG,
        systemPrompt: finalPrompt
    };

    console.log('Call configuration:', callConfig);

    const request = https.request(ULTRAVOX_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': ULTRAVOX_API_KEY
        }
    });

    return new Promise((resolve, reject) => {
        let data = '';

        request.on('response', (response) => {
            // Add status code logging
            console.log('Ultravox API Response Status:', response.statusCode);
            
            response.on('data', chunk => {
                data += chunk;
            });
            
            response.on('end', () => {
                // Add response data logging
                console.log('Ultravox API Response:', data);
                try {
                    const parsedData = JSON.parse(data);
                    console.log('Parsed Response:', parsedData);
                    resolve(parsedData);
                } catch (e) {
                    console.error('Failed to parse response:', e);
                    reject(e);
                }
            });
        });

        request.on('error', (error) => {
            console.error('Ultravox API Error:', error);
            reject(error);
        });

        // Log what we're sending
        console.log('Sending to Ultravox:', JSON.stringify(callConfig, null, 2));
        
        request.write(JSON.stringify(callConfig));
        request.end();
    });
}

// Function to get public URL from ngrok
async function getNgrokUrl() {
    try {
        const response = await axios.get('http://localhost:4040/api/tunnels');
        const publicUrl = response.data.tunnels[0].public_url;
        console.log('Ngrok public URL:', publicUrl);
        return publicUrl;
    } catch (error) {
        console.error('Error getting ngrok URL:', error);
        return null;
    }
}

// Add the status webhook endpoint
app.post('/call-status', async (req, res) => {
    console.log('\n=== 📱 Twilio Status Update ===');
    console.log('Status:', req.body.CallStatus);
    console.log('Duration:', req.body.CallDuration);
    console.log('Timestamp:', req.body.Timestamp);
    console.log('Call SID:', req.body.CallSid);
    console.log('Full status payload:', req.body);
    
    // ... rest of your status handling code
});

// Update the outbound call creation to use dynamic URL
app.post('/outbound-call', async (req, res) => {
    try {
        const { phoneNumber, ...otherVariables } = req.body;
        console.log('📞 Initiating outbound call to:', phoneNumber);
        console.log('📝 Call variables:', otherVariables);
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        console.log('🤖 Creating Ultravox call...');
        const response = await createUltravoxCall(otherVariables);
        console.log('✅ Ultravox call created:', response.callId);
        
        if (!response.joinUrl) {
            throw new Error('No joinUrl received from Ultravox');
        }

        // Get current ngrok URL
        const publicUrl = await getNgrokUrl();
        console.log('🌐 Using webhook URL:', publicUrl);

        const client = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );

        // Store the data we want to send to Make.com later
        const callData = {
            originalRequest: req.body,
            ultravoxResponse: response,
            startTime: new Date().toISOString()
        };
        console.log('💾 Storing initial call data:', callData);

        console.log('📱 Creating Twilio call with TWIML...');
        const call = await client.calls.create({
            twiml: `<Response><Connect><Stream url="${response.joinUrl}"/></Connect></Response>`,
            to: phoneNumber,
            from: process.env.TWILIO_PHONE_NUMBER,
            statusCallback: `${publicUrl}/call-status`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']  // Add more events
        });

        console.log('📱 Twilio call created:', call.sid);
        storeCallData(call.sid, callData);

        res.json({ 
            success: true, 
            callSid: call.sid 
        });

    } catch (error) {
        console.error('❌ Error creating call:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add these with your other routes
app.get('/test', (req, res) => {
    res.json({ status: 'Server is running!' });
});

// Add this with your other app.use statements
app.use('/cal', calRouter);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});