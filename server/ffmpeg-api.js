'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { randomBytes } = require('crypto');

const jobs = new Map();

const ASPECT_FALLBACK = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '4:5': [1080, 1350],
  '21:9': [2560, 1080],
};

function fallbackOutputSize(aspect) {
  const pair = ASPECT_FALLBACK[aspect] || ASPECT_FALLBACK['16:9'];
  return { w: pair[0], h: pair[1] };
}

function whichTool(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}
