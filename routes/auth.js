const express = require('express');

const { getAuthPayload, logout, signInWithGoogle } = require('../services/auth');

const router = express.Router();

router.get('/me', (req, res) => {
  return res.json(getAuthPayload(req));
});

router.post('/google', async (req, res) => {
  try {
    const result = await signInWithGoogle(req.body?.credential);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Google 로그인에 실패했습니다.' });
  }
});

router.post('/logout', (req, res) => {
  const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  logout(token);
  return res.json({ ok: true });
});

module.exports = router;
