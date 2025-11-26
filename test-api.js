/**
 * Local Test Script for Vercel Backend
 * Run this to test your serverless functions locally before deploying
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

console.log('🧪 Testing Linguana Backend API\n');
console.log(`📡 Base URL: ${BASE_URL}\n`);

// Test 1: Health Check
async function testHealth() {
    console.log('1️⃣ Testing Health Check...');
    try {
        const response = await axios.get(`${BASE_URL}/health`);
        console.log('✅ Health check passed:', response.data);
        return true;
    } catch (error) {
        console.error('❌ Health check failed:', error.message);
        return false;
    }
}

// Test 2: Text-to-Speech
async function testTTS() {
    console.log('\n2️⃣ Testing Text-to-Speech...');
    try {
        const response = await axios.post(`${BASE_URL}/speak`, {
            text: 'Hello, this is a test of the text to speech system.',
            voice: 'alloy'
        }, {
            timeout: 30000
        });

        if (response.data.audio) {
            console.log('✅ TTS successful! Audio base64 length:', response.data.audio.length);
            return true;
        } else {
            console.error('❌ TTS failed: No audio in response');
            return false;
        }
    } catch (error) {
        console.error('❌ TTS failed:', error.response?.data || error.message);
        return false;
    }
}

// Test 3: Speech-to-Text (requires an audio file)
async function testSTT() {
    console.log('\n3️⃣ Testing Speech-to-Text...');

    // Check if a sample audio file exists
    const sampleAudioPath = path.join(__dirname, 'test-audio.mp3');

    if (!fs.existsSync(sampleAudioPath)) {
        console.log('⚠️  Skipping STT test: No test-audio.mp3 file found');
        console.log('   To test STT, create a file named "test-audio.mp3" in the backend directory');
        return null;
    }

    try {
        const formData = new FormData();
        formData.append('audio', fs.createReadStream(sampleAudioPath));
        formData.append('language', 'en');

        const response = await axios.post(`${BASE_URL}/transcribe`, formData, {
            headers: formData.getHeaders(),
            timeout: 30000
        });

        if (response.data.text) {
            console.log('✅ STT successful! Transcription:', response.data.text);
            return true;
        } else {
            console.error('❌ STT failed: No text in response');
            return false;
        }
    } catch (error) {
        console.error('❌ STT failed:', error.response?.data || error.message);
        return false;
    }
}

// Run all tests
async function runTests() {
    const results = {
        health: await testHealth(),
        tts: await testTTS(),
        stt: await testSTT()
    };

    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Results Summary');
    console.log('='.repeat(50));
    console.log(`Health Check: ${results.health ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`TTS:          ${results.tts ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`STT:          ${results.stt === null ? '⚠️  SKIP' : results.stt ? '✅ PASS' : '❌ FAIL'}`);
    console.log('='.repeat(50));

    const passCount = Object.values(results).filter(r => r === true).length;
    const totalTests = Object.values(results).filter(r => r !== null).length;

    console.log(`\n✨ Tests Passed: ${passCount}/${totalTests}\n`);

    if (passCount === totalTests) {
        console.log('🎉 All tests passed! Your backend is ready to deploy to Vercel!');
    } else {
        console.log('⚠️  Some tests failed. Please check the errors above.');
        console.log('💡 Make sure your .env file has OPENAI_API_KEY set correctly.');
    }
}

// Run the tests
runTests().catch(error => {
    console.error('💥 Test suite error:', error);
    process.exit(1);
});
