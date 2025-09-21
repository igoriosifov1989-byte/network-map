import { diagrams, type Diagram, type InsertDiagram } from "@shared/schema";

export interface IStorage {
  getDiagram(id: number): Promise<Diagram | undefined>;
  createDiagram(diagram: InsertDiagram): Promise<Diagram>;
  updateDiagram(id: number, diagram: Partial<InsertDiagram>): Promise<Diagram | undefined>;
  deleteDiagram(id: number): Promise<boolean>;
  getAllDiagrams(): Promise<Diagram[]>;
}

export class MemStorage implements IStorage {
  private diagrams: Map<number, Diagram>;
  private currentId: number;

  constructor() {
    this.diagrams = new Map();
    this.currentId = 1;
  }

  async getDiagram(id: number): Promise<Diagram | undefined> {
    return this.diagrams.get(id);
  }

  async createDiagram(insertDiagram: InsertDiagram): Promise<Diagram> {
    const id = this.currentId++;
    const diagram: Diagram = { 
      ...insertDiagram, 
      id, 
      createdAt: new Date() 
    };
    this.diagrams.set(id, diagram);
    return diagram;
  }

  async updateDiagram(id: number, updateData: Partial<InsertDiagram>): Promise<Diagram | undefined> {
    const existing = this.diagrams.get(id);
    if (!existing) return undefined;
    
    const updated: Diagram = { ...existing, ...updateData };
    this.diagrams.set(id, updated);
    return updated;
  }

  async deleteDiagram(id: number): Promise<boolean> {
    return this.diagrams.delete(id);
  }

  async getAllDiagrams(): Promise<Diagram[]> {
    return Array.from(this.diagrams.values());
  }
}

export const storage = new MemStorage();
