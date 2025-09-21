import '@testing-library/jest-dom';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Three.js to prevent WebGL errors in tests
vi.mock('three', () => ({
  Scene: vi.fn(() => ({
    add: vi.fn(),
    remove: vi.fn(),
    traverse: vi.fn(),
    clear: vi.fn(),
    children: [],
  })),
  WebGLRenderer: vi.fn(() => ({
    setSize: vi.fn(),
    render: vi.fn(),
    domElement: document.createElement('canvas'),
    dispose: vi.fn(),
    setPixelRatio: vi.fn(),
    shadowMap: {
      enabled: false,
      type: ''
    }
  })),
  PerspectiveCamera: vi.fn(() => ({
    position: { set: vi.fn() },
    lookAt: vi.fn(),
    updateProjectionMatrix: vi.fn(),
  })),
  Vector3: vi.fn(() => ({
    set: vi.fn(),
    copy: vi.fn(),
    add: vi.fn(),
    sub: vi.fn(),
    multiplyScalar: vi.fn(),
    normalize: vi.fn(),
    dot: vi.fn(),
    cross: vi.fn(),
    distanceTo: vi.fn(() => 1),
    clone: vi.fn(),
    subVectors: vi.fn(),
    x: 0,
    y: 0,
    z: 0,
  })),
  Mesh: vi.fn(),
  MeshLambertMaterial: vi.fn(),
  CylinderGeometry: vi.fn(),
  SpriteMaterial: vi.fn(),
  Sprite: vi.fn(),
  CanvasTexture: vi.fn(),
  DirectionalLight: vi.fn(),
  AmbientLight: vi.fn(),
  OrbitControls: vi.fn(),
  Group: vi.fn(),
  Line: vi.fn(),
  LineBasicMaterial: vi.fn(),
  BufferGeometry: vi.fn(),
  Float32BufferAttribute: vi.fn(),
  ConeGeometry: vi.fn(),
  MeshBasicMaterial: vi.fn(),
  PCFSoftShadowMap: 'PCFSoftShadowMap',
}));

// Mock browser APIs
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock URL.createObjectURL
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'blob:mock-url'),
});