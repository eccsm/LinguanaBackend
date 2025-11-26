/**
 * Multipart Form Data Parser for Vercel Serverless Functions
 * Handles file uploads in serverless environment
 */

const busboy = require('busboy');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Parse multipart/form-data from incoming request
 * @param {Object} req - The incoming request object
 * @returns {Promise<{fields: Object, files: Object}>}
 */
function parseMultipartForm(req) {
    return new Promise((resolve, reject) => {
        const bb = busboy({ headers: req.headers });
        const fields = {};
        const files = {};

        bb.on('file', (name, file, info) => {
            const { filename, encoding, mimeType } = info;

            // Use Vercel's /tmp directory for temporary file storage
            const tmpDir = os.tmpdir();
            const filepath = path.join(tmpDir, `${Date.now()}-${filename}`);
            const writeStream = fs.createWriteStream(filepath);

            file.pipe(writeStream);

            writeStream.on('finish', () => {
                files[name] = {
                    filepath,
                    filename,
                    encoding,
                    mimetype: mimeType,
                    size: fs.statSync(filepath).size
                };
            });

            writeStream.on('error', reject);
        });

        bb.on('field', (name, value) => {
            fields[name] = value;
        });

        bb.on('finish', () => {
            resolve({ fields, files });
        });

        bb.on('error', reject);

        req.pipe(bb);
    });
}

module.exports = { parseMultipartForm };
