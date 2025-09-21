import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../routes';
import { storage } from '../storage';
import * as networkGenerator from '../networkGenerator';

describe('API Routes', () => {
  let app: express.Express;
  let server: any;

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    server = await registerRoutes(app);
  });

  afterEach((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('Diagram Routes', () => {
    describe('GET /api/diagrams', () => {
      it('should return empty array initially', async () => {
        const response = await request(app).get('/api/diagrams');
        
        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });
    });

    describe('POST /api/diagrams', () => {
      it('should create a new diagram', async () => {
        const diagramData = {
          name: 'Test Diagram',
          description: 'A test diagram',
          data: {
            nodes: [
              { id: 'node1', label: 'Node 1', service: 'service1' }
            ],
            edges: []
          },
          settings: {
            showLabels: true,
            showArrows: true,
            nodeColor: 'blue',
            nodeSpacing: 100
          }
        };

        const response = await request(app)
          .post('/api/diagrams')
          .send(diagramData);

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
          name: 'Test Diagram',
          description: 'A test diagram'
        });
        expect(response.body.id).toBeDefined();
        expect(response.body.createdAt).toBeDefined();
      });

      it('should validate required fields', async () => {
        const invalidData = {
          description: 'Missing name field'
        };

        const response = await request(app)
          .post('/api/diagrams')
          .send(invalidData);

        expect(response.status).toBe(400);
      });
    });

    describe('GET /api/diagrams/:id', () => {
      it('should return specific diagram by ID', async () => {
        // First create a diagram
        const diagramData = {
          name: 'Test Diagram',
          description: 'A test diagram',
          data: { nodes: [], edges: [] },
          settings: { showLabels: true, showArrows: true, nodeColor: 'blue', nodeSpacing: 100 }
        };

        const createResponse = await request(app)
          .post('/api/diagrams')
          .send(diagramData);

        const diagramId = createResponse.body.id;

        // Then fetch it by ID
        const response = await request(app).get(`/api/diagrams/${diagramId}`);
        
        expect(response.status).toBe(200);
        expect(response.body.id).toBe(diagramId);
        expect(response.body.name).toBe('Test Diagram');
      });

      it('should return 404 for non-existent diagram', async () => {
        const response = await request(app).get('/api/diagrams/999');
        
        expect(response.status).toBe(404);
      });
    });
  });

  describe('Network Event Routes', () => {
    describe('GET /api/network/events', () => {
      it('should return network events within time range', async () => {
        const response = await request(app).get('/api/network/events');
        
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
      });

      it('should handle time range parameters', async () => {
        const fromTime = new Date('2025-01-06T12:00:00Z').toISOString();
        const toTime = new Date('2025-01-06T13:00:00Z').toISOString();

        const response = await request(app)
          .get('/api/network/events')
          .query({ from: fromTime, to: toTime });
        
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
      });

      it('should handle limit parameter', async () => {
        const response = await request(app)
          .get('/api/network/events')
          .query({ limit: 10 });
        
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
      });
    });

    describe('POST /api/network/generate/start', () => {
      it('should start network event generation', async () => {
        const response = await request(app)
          .post('/api/network/generate/start')
          .send({ intervalMs: 1000 });
        
        expect(response.status).toBe(200);
        expect(response.body.message).toContain('started');
      });
    });

    describe('POST /api/network/generate/stop', () => {
      it('should stop network event generation', async () => {
        const response = await request(app).post('/api/network/generate/stop');
        
        expect(response.status).toBe(200);
        expect(response.body.message).toContain('stopped');
      });
    });
  });

  describe('File Upload Routes', () => {
    describe('POST /api/parse-file', () => {
      it('should handle CSV file upload', async () => {
        const csvContent = 'source,target\nnode1,node2\nnode2,node3';
        
        const response = await request(app)
          .post('/api/parse-file')
          .attach('file', Buffer.from(csvContent), {
            filename: 'test.csv',
            contentType: 'text/csv'
          });
        
        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.nodes).toBeDefined();
        expect(response.body.data.edges).toBeDefined();
        expect(response.body.stats).toBeDefined();
      });

      it('should reject files without required columns', async () => {
        const invalidCsv = 'col1,col2\nvalue1,value2';
        
        const response = await request(app)
          .post('/api/parse-file')
          .attach('file', Buffer.from(invalidCsv), {
            filename: 'invalid.csv',
            contentType: 'text/csv'
          });
        
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('required columns');
      });

      it('should handle multiple file upload', async () => {
        const csvContent1 = 'source,target\nnode1,node2';
        const csvContent2 = 'source,target\nnode2,node3';
        
        const response = await request(app)
          .post('/api/parse-file')
          .attach('files', Buffer.from(csvContent1), {
            filename: 'test1.csv',
            contentType: 'text/csv'
          })
          .attach('files', Buffer.from(csvContent2), {
            filename: 'test2.csv',
            contentType: 'text/csv'
          });
        
        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(response.body.filenames).toHaveLength(2);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 for unknown routes', async () => {
      const response = await request(app).get('/api/unknown-route');
      
      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/diagrams')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');
      
      expect(response.status).toBe(400);
    });
  });
});