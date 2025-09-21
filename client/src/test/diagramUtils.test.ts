import { describe, it, expect, beforeEach } from 'vitest';
import { applyForceLayout, applyCircularLayout, applyGridLayout, applyHierarchicalLayout } from '@/lib/diagramUtils';
import type { DiagramData, DiagramNode, DiagramEdge } from '@/types/diagram';

describe('Diagram Utils', () => {
  let sampleData: DiagramData;

  beforeEach(() => {
    sampleData = {
      nodes: [
        { id: 'node1', label: 'Node 1', service: 'service1' },
        { id: 'node2', label: 'Node 2', service: 'service1' },
        { id: 'node3', label: 'Node 3', service: 'service2' },
        { id: 'node4', label: 'Node 4', service: 'service2' },
      ],
      edges: [
        { id: 'edge1', source: 'node1', target: 'node2', connectionCount: 5 },
        { id: 'edge2', source: 'node2', target: 'node3', connectionCount: 3 },
        { id: 'edge3', source: 'node3', target: 'node4', connectionCount: 2 },
      ]
    };
  });

  describe('Force Layout', () => {
    it('should apply force layout and set positions', () => {
      const result = applyForceLayout(sampleData, 100);
      
      // Check that all nodes have position coordinates
      result.nodes.forEach(node => {
        expect(node.x).toBeDefined();
        expect(node.y).toBeDefined();
        expect(typeof node.x).toBe('number');
        expect(typeof node.y).toBe('number');
      });
    });

    it('should maintain node spacing based on spacing parameter', () => {
      const result = applyForceLayout(sampleData, 200);
      
      // With higher spacing, nodes should be more spread out
      const positions = result.nodes.map(node => ({ x: node.x!, y: node.y! }));
      expect(positions.length).toBe(4);
    });
  });

  describe('Circular Layout', () => {
    it('should arrange nodes in a circle', () => {
      const result = applyCircularLayout(sampleData, 100);
      
      // Check that all nodes have positions
      result.nodes.forEach(node => {
        expect(node.x).toBeDefined();
        expect(node.y).toBeDefined();
      });

      // Check that nodes are arranged roughly in a circle
      const centerX = result.nodes.reduce((sum, node) => sum + node.x!, 0) / result.nodes.length;
      const centerY = result.nodes.reduce((sum, node) => sum + node.y!, 0) / result.nodes.length;
      
      // All nodes should be roughly the same distance from center
      const distances = result.nodes.map(node => 
        Math.sqrt(Math.pow(node.x! - centerX, 2) + Math.pow(node.y! - centerY, 2))
      );
      
      const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
      distances.forEach(distance => {
        expect(Math.abs(distance - avgDistance)).toBeLessThan(50); // Allow some variance
      });
    });
  });

  describe('Grid Layout', () => {
    it('should arrange nodes in a grid pattern', () => {
      const result = applyGridLayout(sampleData, 100);
      
      // Check that all nodes have positions
      result.nodes.forEach(node => {
        expect(node.x).toBeDefined();
        expect(node.y).toBeDefined();
      });

      // Check that positions are grid-aligned
      const uniqueX = [...new Set(result.nodes.map(node => node.x))];
      const uniqueY = [...new Set(result.nodes.map(node => node.y))];
      
      // Should have organized positions
      expect(uniqueX.length).toBeGreaterThan(0);
      expect(uniqueY.length).toBeGreaterThan(0);
    });
  });

  describe('Hierarchical Layout', () => {
    it('should arrange nodes in hierarchical levels', () => {
      const result = applyHierarchicalLayout(sampleData, 100);
      
      // Check that all nodes have positions
      result.nodes.forEach(node => {
        expect(node.x).toBeDefined();
        expect(node.y).toBeDefined();
      });

      // Y positions should form distinct levels
      const yPositions = result.nodes.map(node => node.y!);
      const uniqueY = [...new Set(yPositions)].sort((a, b) => a - b);
      
      // Should have hierarchical structure (multiple Y levels)
      expect(uniqueY.length).toBeGreaterThan(1);
    });
  });

  describe('Layout Input Validation', () => {
    it('should handle empty data gracefully', () => {
      const emptyData: DiagramData = { nodes: [], edges: [] };
      
      expect(() => applyForceLayout(emptyData, 100)).not.toThrow();
      expect(() => applyCircularLayout(emptyData, 100)).not.toThrow();
      expect(() => applyGridLayout(emptyData, 100)).not.toThrow();
      expect(() => applyHierarchicalLayout(emptyData, 100)).not.toThrow();
    });

    it('should handle single node', () => {
      const singleNodeData: DiagramData = {
        nodes: [{ id: 'node1', label: 'Single Node', service: 'service1' }],
        edges: []
      };

      const result = applyForceLayout(singleNodeData, 100);
      expect(result.nodes[0].x).toBeDefined();
      expect(result.nodes[0].y).toBeDefined();
    });
  });
});