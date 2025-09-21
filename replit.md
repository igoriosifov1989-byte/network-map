# Diagram Generator Application

## Overview
This full-stack web application visualizes network diagrams from uploaded data or real-time streams. It generates interactive graph visualizations with features like connection strength indicators, multiple layout algorithms, and extensive customization. The system aggregates data to present comprehensive relationship networks, indicating connection frequency and supporting detailed traffic analysis. Its vision is to provide clear, interactive insights into complex system interactions, aiding in performance monitoring, troubleshooting, and architectural understanding.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack Query (server state), React hooks (local state)
- **Styling**: Tailwind CSS with shadcn/ui
- **Build Tool**: Vite
- **Visualization**: D3.js (graph rendering), Three.js (3D visualization)
- **UI/UX**: Responsive design, sidebar for controls, interactive canvas, dark theme, contextual help system. Features include:
    - Multiple layout algorithms (force-directed, hierarchical, circular, grid).
    - Connection strength visualized by line thickness and volumetric tubes.
    - Curved arrows for multiple relationships between nodes.
    - Hover tooltips for detailed information (e.g., connection counts, status codes).
    - Customizable node colors, spacing, labels, and arrow display.
    - SVG and PNG export capabilities.
    - Interactive orientation cube and coordinate axes for 3D navigation.
    - Trace highlighting with color changes (selected elements original color, others gray).
    - Level of Detail (LOD) system for performance optimization with large datasets.
    - Separate spacing controls for nodes within clusters and between clusters.
    - Semi-transparent tenant boundary spheres that become opaque at low LOD.
    - Unified connection color scheme: purple for incoming, green for outgoing.

### Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ESM modules)
- **File Processing**: Multer, xlsx, csv-parse (for file uploads - currently inactive in UI)
- **Data Generation**: Real-time Network Events and OpenTelemetry trace generators with configurable intervals.
- **Data Aggregation**: Real-time aggregation of service interactions and performance metrics (success rates, error percentages).

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM (primary). In-memory storage for development.
- **Session Management**: connect-pg-simple.
- **Schema**: Tables for Diagrams (JSONB for flexibility), NetworkEvents, Traces, and Spans (OpenTelemetry compliant).
- **Persistence**: Generated data persists in PostgreSQL across sessions.

### System Design
- **Data Flow**: Supports real-time data streaming from generators to PostgreSQL, backend processing for statistics, and frontend visualization. File upload functionality exists but is currently focused on real-time data.
- **Scalability**: Designed for 100+ services with features like:
    - Tenant-based grouping of services.
    - Adaptive LOD system based on service count or camera distance.
    - Optimized rendering with object caching and material reuse.
    - Obstacle avoidance pathfinding for trunk routes between tenant clusters.
    - Bidirectional magistral (highway) lines between tenants with uniform thickness and traffic direction indicators.
    - Branch connections from magistrals to service endpoints within tenant spheres.
- **Deployment**: Docker with multi-stage builds, Kubernetes orchestration with Kustomize.

## External Dependencies

### Core Libraries
- **Frontend**: `react`, `react-dom`, `@tanstack/react-query`, `@radix-ui/*`, `shadcn/ui`, `d3`, `three`.
- **Backend**: `multer`, `xlsx`, `csv-parse`, `drizzle-orm`, `@neondatabase/serverless`, `zod`, `@hookform/resolvers`.

### Development Tools
- `vite`, `esbuild`, `tsx`, `tailwindcss`, `autoprefixer`, `postcss`, `typescript`, `vitest`.