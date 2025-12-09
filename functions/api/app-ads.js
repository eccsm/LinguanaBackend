// API endpoint to serve app-ads.txt for AdMob verification
module.exports = function (req, res) {
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send('google.com, pub-5060300106472726, DIRECT, f08c47fec0942fa0');
};
