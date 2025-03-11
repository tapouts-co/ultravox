import axios from 'axios';
import { getCheckAvailabilityTool } from './tools/checkAvailabilityTool.js';
import { getSetAppointmentTool } from './tools/setAppointmentTool.js';

// Function to get ngrok URL
async function getNgrokUrl() {
    try {
        const response = await axios.get('http://localhost:4040/api/tunnels');
        const publicUrl = response.data.tunnels[0].public_url;
        console.log('Tools base URL:', publicUrl);
        return publicUrl;
    } catch (error) {
        console.error('Error getting ngrok URL:', error);
        return null;
    }
}

// Make the config function async to get dynamic URL
export async function getUltravoxConfig() {
    const toolsBaseUrl = await getNgrokUrl();
    console.log('🛠️ Tools base URL:', toolsBaseUrl);
    
    if (!toolsBaseUrl) {
        throw new Error('Could not get ngrok URL for tools');
    }

    const selectedTools = [
        getCheckAvailabilityTool(toolsBaseUrl),
        getSetAppointmentTool(toolsBaseUrl),
        {
            "toolName": "hangUp"
        }
    ];

    console.log('🔧 Selected tools configured:', selectedTools.length);

    const config = {
        model: 'fixie-ai/ultravox',
        voice: 'Mark',
        temperature: 0.3,
        firstSpeaker: 'FIRST_SPEAKER_USER',
        selectedTools,
        medium: { "twilio": {} },
        recordingEnabled: true,
        maxDuration: '900s',
        joinTimeout: '30s'
    };

    console.log('⚙️ Ultravox configuration:', JSON.stringify(config, null, 2));
    return config;
} 