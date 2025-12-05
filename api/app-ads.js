// API endpoint to serve app-ads.txt for AdMob verification
export default function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 's-maxage=86400');
    res.status(200).send('google.com, pub-5060300106472726, DIRECT, f08c47fec0942fa0');
}
