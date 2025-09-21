import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Statistics from '@/components/Statistics';
import TraceList from '@/components/TraceList';
import type { DiagramData } from '@/types/diagram';

// Create a test query client
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

// Wrapper component for tests that need QueryClient
const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('Statistics Component', () => {
  const mockData: DiagramData = {
    nodes: [
      { id: 'node1', label: 'API Service', service: 'api-service' },
      { id: 'node2', label: 'Gateway Service', service: 'gateway-service' },
    ],
    edges: [
      {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        connectionCount: 100,
        statusCounts: { '200': 80, '404': 15, '500': 5 }
      }
    ]
  };

  const mockStats = {
    nodeCount: 2,
    edgeCount: 1,
    componentCount: 1
  };

  it('should render statistics correctly', () => {
    render(
      <TestWrapper>
        <Statistics stats={mockStats} data={mockData} />
      </TestWrapper>
    );

    expect(screen.getByText('Request Statistics')).toBeInTheDocument();
  });

  it('should display HTTP status percentages', () => {
    render(
      <TestWrapper>
        <Statistics stats={mockStats} data={mockData} />
      </TestWrapper>
    );

    // Should show success percentage (80/100 = 80%)
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('should handle connection filtering', async () => {
    render(
      <TestWrapper>
        <Statistics stats={mockStats} data={mockData} />
      </TestWrapper>
    );

    // Should have a connection filter dropdown if multiple connections exist
    const filterSelect = screen.getByRole('combobox');
    expect(filterSelect).toBeInTheDocument();
  });

  it('should handle null data gracefully', () => {
    render(
      <TestWrapper>
        <Statistics stats={null} data={null} />
      </TestWrapper>
    );

    expect(screen.getByText('Request Statistics')).toBeInTheDocument();
  });
});

describe('TraceList Component', () => {
  const mockData: DiagramData = {
    nodes: [
      { id: 'node1', label: 'Service 1', service: 'service1' },
      { id: 'node2', label: 'Service 2', service: 'service2' },
    ],
    edges: [
      {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        traceId: 'trace-001',
        connectionCount: 5
      },
      {
        id: 'edge2',
        source: 'node2',
        target: 'node1',
        traceId: 'trace-002',
        connectionCount: 3
      }
    ]
  };

  const mockOnTraceSelect = vi.fn();

  beforeEach(() => {
    mockOnTraceSelect.mockClear();
  });

  it('should render trace list with trace IDs', () => {
    render(
      <TraceList 
        data={mockData} 
        selectedTraceId={null} 
        onTraceSelect={mockOnTraceSelect} 
      />
    );

    expect(screen.getByText('Trace IDs')).toBeInTheDocument();
    expect(screen.getByText('trace-001')).toBeInTheDocument();
    expect(screen.getByText('trace-002')).toBeInTheDocument();
  });

  it('should call onTraceSelect when trace is clicked', async () => {
    const user = userEvent.setup();
    
    render(
      <TraceList 
        data={mockData} 
        selectedTraceId={null} 
        onTraceSelect={mockOnTraceSelect} 
      />
    );

    const traceButton = screen.getByText('trace-001').closest('div');
    if (traceButton) {
      await user.click(traceButton);
      expect(mockOnTraceSelect).toHaveBeenCalledWith('trace-001');
    }
  });

  it('should highlight selected trace', () => {
    render(
      <TraceList 
        data={mockData} 
        selectedTraceId="trace-001" 
        onTraceSelect={mockOnTraceSelect} 
      />
    );

    const selectedTrace = screen.getByText('trace-001').closest('div');
    expect(selectedTrace).toHaveClass('bg-blue-100');
  });

  it('should deselect trace when clicking selected trace', async () => {
    const user = userEvent.setup();
    
    render(
      <TraceList 
        data={mockData} 
        selectedTraceId="trace-001" 
        onTraceSelect={mockOnTraceSelect} 
      />
    );

    const traceButton = screen.getByText('trace-001').closest('div');
    if (traceButton) {
      await user.click(traceButton);
      expect(mockOnTraceSelect).toHaveBeenCalledWith(null);
    }
  });

  it('should show connection count for each trace', () => {
    render(
      <TraceList 
        data={mockData} 
        selectedTraceId={null} 
        onTraceSelect={mockOnTraceSelect} 
      />
    );

    // Should show connection counts in parentheses
    expect(screen.getByText('(1)')).toBeInTheDocument(); // One connection per trace
  });

  it('should handle empty data', () => {
    render(
      <TraceList 
        data={{ nodes: [], edges: [] }} 
        selectedTraceId={null} 
        onTraceSelect={mockOnTraceSelect} 
      />
    );

    expect(screen.getByText('Нет данных для отображения')).toBeInTheDocument();
  });

  it('should handle null data', () => {
    render(
      <TraceList 
        data={null} 
        selectedTraceId={null} 
        onTraceSelect={mockOnTraceSelect} 
      />
    );

    expect(screen.getByText('Нет данных для отображения')).toBeInTheDocument();
  });
});

describe('Component Integration', () => {
  it('should work together in typical usage scenario', () => {
    const mockData: DiagramData = {
      nodes: [
        { id: 'api-service_auth', label: 'auth', service: 'api-service' },
        { id: 'gateway-service_contact', label: 'contact', service: 'gateway-service' },
      ],
      edges: [
        {
          id: 'edge1',
          source: 'api-service_auth',
          target: 'gateway-service_contact',
          traceId: 'trace-001',
          connectionCount: 50,
          statusCounts: { '200': 45, '404': 3, '500': 2 }
        }
      ]
    };

    const mockStats = {
      nodeCount: 2,
      edgeCount: 1,
      componentCount: 1
    };

    const mockOnTraceSelect = vi.fn();

    render(
      <TestWrapper>
        <div>
          <Statistics stats={mockStats} data={mockData} />
          <TraceList 
            data={mockData} 
            selectedTraceId={null} 
            onTraceSelect={mockOnTraceSelect} 
          />
        </div>
      </TestWrapper>
    );

    // Both components should render
    expect(screen.getByText('Request Statistics')).toBeInTheDocument();
    expect(screen.getByText('Trace IDs')).toBeInTheDocument();
    expect(screen.getByText('trace-001')).toBeInTheDocument();
  });
});