import axios from 'axios';

// Store call data temporarily (in production, use a database)
const callData = new Map();

export function storeCallData(callSid, data) {
    console.log('Storing data for call:', callSid, data);
    callData.set(callSid, data);
    // Log current stored calls
    console.log('Currently stored calls:', Array.from(callData.keys()));
}

// Helper function to wait
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to safely stringify objects
const safeStringify = (obj) => {
    try {
        return JSON.stringify(obj, null, 2);
    } catch (error) {
        return '[Unable to stringify object]';
    }
};

async function getUltravoxRecording(callId, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            console.log(`\nFetching recording URL - Attempt ${attempt + 1} of ${retries + 1}`);
            console.log('Ultravox call ID:', callId);
            
            if (attempt > 0) {
                console.log('Waiting 5 seconds before retry...');
                await delay(5000);
            }
            
            const response = await fetch(
                `https://api.ultravox.ai/api/calls/${callId}/recording`,
                {
                    method: 'GET',
                    headers: {
                        'X-API-Key': 'eFHXM1Qx.6Asywdfr0l9ke690WTQNo5T12pwEeb0N'
                    },
                    redirect: 'follow'  // Follow redirects
                }
            );

            console.log('Response status:', response.status);
            
            if (response.ok) {
                if (response.redirected) {
                    console.log('Got recording URL (from redirect):', response.url);
                    return response.url;  // This is the final URL after redirects
                } else {
                    console.log('No redirect received, will retry');
                }
            } else {
                console.error('API request failed:', response.status);
            }
            
        } catch (error) {
            console.error('Error fetching recording:', {
                attempt: attempt + 1,
                error: error.message
            });
            
            if (attempt === retries) {
                console.log('Failed to get recording URL after all attempts');
                return null;
            }
        }
    }
    return null;
}

// Add this function to get call transcript
async function getCallTranscript(callId) {
    let allMessages = [];
    let nextCursor = null;

    try {
        console.log('Fetching transcript for call:', callId);
        
        do {
            const url = `https://api.ultravox.ai/api/calls/${callId}/messages${nextCursor ? `?cursor=${nextCursor}` : ''}`;
            
            const response = await fetch(url, {
                headers: {
                    'X-API-Key': 'eFHXM1Qx.6Asywdfr0l9ke690WTQNo5T12pwEeb0N',
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // Add the current page of results to our collection
            allMessages = allMessages.concat(data.results || []);

            // Update the cursor for the next iteration
            nextCursor = data.next ? new URL(data.next).searchParams.get('cursor') : null;

        } while (nextCursor);

        // Filter and combine messages into a conversation string
        const conversation = allMessages
            .filter(msg => 
                // Only include user and agent messages with text
                (msg.role === 'MESSAGE_ROLE_USER' || msg.role === 'MESSAGE_ROLE_AGENT') && 
                msg.text
            )
            .map(msg => {
                const speaker = msg.role === 'MESSAGE_ROLE_USER' ? 'Customer' : 'Agent';
                return `${speaker}: ${msg.text}`;
            })
            .join('\n');

        console.log('Transcript compiled');
        return conversation;

    } catch (error) {
        console.error('Error fetching Ultravox messages:', error);
        return null;
    }
}

// Update the webhook notification to include transcript
async function notifyMakeWebhook(callSid, status, data) {
    try {
        // Get recording URL and transcript if we have a call ID
        let recordingUrl = null;
        let transcript = null;
        
        if (data.ultravoxResponse?.callId) {
            const callId = data.ultravoxResponse.callId;
            
            // Get recording URL
            recordingUrl = await getUltravoxRecording(callId);
            
            // Get transcript
            transcript = await getCallTranscript(callId);
        }

        // Prepare payload with recording URL, transcript and phone numbers
        const payload = {
            callSid,
            status,
            ultravoxCallId: data.ultravoxResponse?.callId,
            recordingUrl,
            transcript,  // Add transcript to payload
            callDetails: {
                ...data.callDetails,
                to: data.originalRequest?.phoneNumber,
                from: process.env.TWILIO_PHONE_NUMBER
            },
            originalRequest: data.originalRequest
        };

        console.log('Sending to Make.com:', {
            callSid,
            status,
            ultravoxCallId: data.ultravoxResponse?.callId,
            hasRecording: !!recordingUrl,
            hasTranscript: !!transcript,
            messageCount: transcript?.length,
            to: data.originalRequest?.phoneNumber,
            from: process.env.TWILIO_PHONE_NUMBER
        });

        // Send to Make.com
        const response = await axios.post(process.env.MAKE_WEBHOOK_URL, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        console.log('Make.com response:', response.status);
        return true;
    } catch (error) {
        console.error('Make.com notification failed:', error.message);
        return false;
    }
}

export function handleCallStatus(req, res) {
    console.log('\n=== Received Twilio Status Callback ===');
    
    // Safely log the request body
    const body = req.body;
    console.log('Request body:', {
        CallSid: body.CallSid,
        CallStatus: body.CallStatus,
        CallDuration: body.CallDuration,
        Timestamp: body.Timestamp
    });

    // Parse the form data
    const { 
        CallSid, 
        CallStatus,
        CallDuration,
        Timestamp,
        RecordingUrl
    } = req.body;

    if (!CallSid) {
        console.error('No CallSid received in webhook');
        console.log('Full request body:', req.body);
        return res.sendStatus(400);
    }

    console.log(`\nProcessing call status update:`, {
        callSid: CallSid,
        status: CallStatus,
        duration: CallDuration,
        timestamp: Timestamp,
        recordingUrl: RecordingUrl
    });

    // Get stored data for this call
    const storedData = callData.get(CallSid);
    console.log('\nStored data for call:', {
        callSid: CallSid,
        hasStoredData: !!storedData,
        storedData: storedData || 'No data found'
    });

    if (CallStatus === 'completed') {
        console.log('\nCall completed, preparing webhook data');
        
        // Prepare enhanced payload
        const enhancedData = {
            ...storedData,
            callDetails: {
                duration: CallDuration,
                timestamp: Timestamp,
                recordingUrl: RecordingUrl
            }
        };

        console.log('Enhanced data prepared:', JSON.stringify(enhancedData, null, 2));
        console.log('\nTriggering Make.com webhook...');
        
        notifyMakeWebhook(CallSid, CallStatus, enhancedData)
            .then(success => {
                console.log('Make.com webhook notification result:', success ? 'Success' : 'Failed');
            })
            .catch(err => {
                console.error('Error in webhook notification:', err);
            });
    } else {
        console.log(`\nCall status '${CallStatus}' is not 'completed', skipping Make.com notification`);
    }

    console.log('\nSending 200 OK response to Twilio');
    res.sendStatus(200);
    console.log('--- End Status Callback Processing ---\n');
} 