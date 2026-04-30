const fs = require('fs');
const path = require('path');

const assets = [
  ['nodes/JsonataMapper/jsonataMapper.svg', 'dist/nodes/JsonataMapper/jsonataMapper.svg'],
  ['credentials/genericLlmApi.svg', 'dist/credentials/genericLlmApi.svg'],
];

for (const [src, dest] of assets) {
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
}
