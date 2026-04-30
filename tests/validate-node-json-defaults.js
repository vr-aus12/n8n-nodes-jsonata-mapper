const { JsonataMapper } = require('../dist/nodes/JsonataMapper/JsonataMapper.node.js');
const { GenericLlmApi } = require('../dist/credentials/GenericLlmApi.credentials.js');

const node = new JsonataMapper();
const credentials = new GenericLlmApi();
let failures = 0;

function checkProperties(owner, properties) {
  for (const property of properties) {
    if (property.type === 'json') {
      try {
        JSON.parse(property.default);
        console.log(`✅ ${owner}.${property.name} default is valid JSON`);
      } catch (error) {
        failures += 1;
        console.error(`❌ ${owner}.${property.name} default is invalid JSON`);
        console.error(property.default);
        console.error(error.message);
      }
    }
  }
}

checkProperties('JsonataMapper', node.description.properties);
checkProperties('GenericLlmApi', credentials.properties);

if (failures > 0) process.exit(1);
