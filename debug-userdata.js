// Simple test to debug userData issue
console.log('=== Testing Three.js userData behavior ===');

// Test 1: Basic userData assignment
console.log('\n--- Test 1: Basic userData assignment ---');
const testObject = { userData: {} };
testObject.userData.nodeId = 'test-node-123';
testObject.userData.isEndpoint = true;
console.log('After assignment:', {
  nodeId: testObject.userData?.nodeId,
  isEndpoint: testObject.userData?.isEndpoint,
  keys: Object.keys(testObject.userData)
});

// Test 2: Map storage behavior
console.log('\n--- Test 2: Map storage behavior ---');
const testMap = new Map();
testMap.set('test-key', testObject);
const retrieved = testMap.get('test-key');
console.log('After Map storage/retrieval:', {
  nodeId: retrieved.userData?.nodeId,
  isEndpoint: retrieved.userData?.isEndpoint,
  keys: Object.keys(retrieved.userData)
});

// Test 3: Object mutation after storage
console.log('\n--- Test 3: Object mutation after storage ---');
retrieved.userData = {};
console.log('After clearing userData:', {
  nodeId: retrieved.userData?.nodeId,
  isEndpoint: retrieved.userData?.isEndpoint,
  keys: Object.keys(retrieved.userData)
});

// Test 4: Re-assignment
console.log('\n--- Test 4: Re-assignment ---');
retrieved.userData = {
  nodeId: 'new-node-456',
  isEndpoint: false,
  test: 'value'
};
console.log('After re-assignment:', {
  nodeId: retrieved.userData?.nodeId,
  isEndpoint: retrieved.userData?.isEndpoint,
  keys: Object.keys(retrieved.userData)
});

console.log('\n=== Test completed ===');