import { describe, it, expect } from 'vitest';
import { processNetworkEvents, mergeEventData } from '@/lib/eventProcessor';
import type { ParsedFileData } from '@/types/diagram';

describe('Event Processor', () => {
  const mockNetworkEvents = [
    {
      id: 1,
      source: 'api-service1_auth',
      target: 'gateway-service1_contact',
      sourceService: 'api-service1',
      targetService: 'gateway-service1',
      sourceLabel: 'auth',
      targetLabel: 'contact',
      status: '200',
      method: 'POST',
      responseTime: 150,
      timestamp: '2025-01-06T12:00:00Z',
      traceId: 'trace-001',
      metadata: {}
    },
    {
      id: 2,
      source: 'gateway-service1_contact',
      target: 'platform-service2_auth',
      sourceService: 'gateway-service1',
      targetService: 'platform-service2',
      sourceLabel: 'contact',
      targetLabel: 'auth',
      status: '200',
      method: 'GET',
      responseTime: 75,
      timestamp: '2025-01-06T12:00:01Z',
      traceId: 'trace-001',
      metadata: {}
    },
    {
      id: 3,
      source: 'api-service1_auth',
      target: 'gateway-service1_contact',
      sourceService: 'api-service1',
      targetService: 'gateway-service1',
      sourceLabel: 'auth',
      targetLabel: 'contact',
      status: '404',
      method: 'POST',
      responseTime: 200,
      timestamp: '2025-01-06T12:00:02Z',
      traceId: 'trace-002',
      metadata: {}
    }
  ];

  describe('processNetworkEvents', () => {
    it('should process network events into diagram format', () => {
      const result = processNetworkEvents(mockNetworkEvents);

      expect(result.data.nodes).toHaveLength(4); // 4 unique endpoints
      expect(result.data.edges).toHaveLength(2); // 2 unique connections

      // Check nodes are created correctly
      const nodeIds = result.data.nodes.map(node => node.id);
      expect(nodeIds).toContain('api-service1_auth');
      expect(nodeIds).toContain('gateway-service1_contact');
      expect(nodeIds).toContain('platform-service2_auth');

      // Check services are assigned correctly
      const authNode = result.data.nodes.find(node => node.id === 'api-service1_auth');
      expect(authNode?.service).toBe('api-service1');
      expect(authNode?.label).toBe('auth');
    });

    it('should aggregate connection counts correctly', () => {
      const result = processNetworkEvents(mockNetworkEvents);

      // Find the edge between api-service1_auth and gateway-service1_contact
      const edge = result.data.edges.find(edge => 
        edge.source === 'api-service1_auth' && edge.target === 'gateway-service1_contact'
      );
      
      expect(edge?.connectionCount).toBe(2); // Two events for this connection
    });

    it('should track status codes correctly', () => {
      const result = processNetworkEvents(mockNetworkEvents);

      const edge = result.data.edges.find(edge => 
        edge.source === 'api-service1_auth' && edge.target === 'gateway-service1_contact'
      );
      
      expect(edge?.statusCounts).toEqual({
        '200': 1,
        '404': 1
      });
    });

    it('should include trace IDs in edges', () => {
      const result = processNetworkEvents(mockNetworkEvents);

      const edges = result.data.edges;
      expect(edges.some(edge => edge.traceId?.includes('trace-001'))).toBe(true);
      expect(edges.some(edge => edge.traceId?.includes('trace-002'))).toBe(true);
    });

    it('should calculate statistics correctly', () => {
      const result = processNetworkEvents(mockNetworkEvents);

      expect(result.stats.nodeCount).toBe(4);
      expect(result.stats.edgeCount).toBe(2);
      expect(result.stats.componentCount).toBeGreaterThan(0);
    });
  });

  describe('mergeEventData', () => {
    it('should merge existing data with new event data', () => {
      const existingData: ParsedFileData = {
        data: {
          nodes: [
            { id: 'existing-node', label: 'Existing', service: 'existing-service' }
          ],
          edges: [
            { id: 'existing-edge', source: 'node1', target: 'existing-node', connectionCount: 1 }
          ]
        },
        stats: { nodeCount: 1, edgeCount: 1, componentCount: 1 }
      };

      const eventData = processNetworkEvents(mockNetworkEvents);
      const result = mergeEventData(existingData, eventData);

      // Should have nodes from both datasets
      expect(result.data.nodes.length).toBeGreaterThan(existingData.data.nodes.length);
      expect(result.data.edges.length).toBeGreaterThan(existingData.data.edges.length);

      // Should preserve existing nodes
      const existingNode = result.data.nodes.find(node => node.id === 'existing-node');
      expect(existingNode).toBeDefined();
    });

    it('should handle null existing data', () => {
      const eventData = processNetworkEvents(mockNetworkEvents);
      const result = mergeEventData(null, eventData);

      expect(result).toEqual(eventData);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty events array', () => {
      const result = processNetworkEvents([]);
      
      expect(result.data.nodes).toHaveLength(0);
      expect(result.data.edges).toHaveLength(0);
      expect(result.stats.nodeCount).toBe(0);
      expect(result.stats.edgeCount).toBe(0);
    });

    it('should handle malformed events gracefully', () => {
      const malformedEvents = [
        {
          id: 1,
          source: '',
          target: '',
          sourceService: 'service1',
          targetService: 'service2',
          sourceLabel: 'label1',
          targetLabel: 'label2',
          status: '200',
          method: 'GET',
          responseTime: 100,
          timestamp: '2025-01-06T12:00:00Z',
          metadata: {}
        }
      ];

      expect(() => processNetworkEvents(malformedEvents as any)).not.toThrow();
    });
  });
});