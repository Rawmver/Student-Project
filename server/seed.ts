import { storage } from "./storage";
import { db } from "./db";
import { members, groups } from "@shared/schema";

async function seed() {
  const existingGroups = await storage.getGroups();
  if (existingGroups.length > 0) {
    console.log("Database already seeded");
    return;
  }

  console.log("Seeding database...");

  const group1 = await storage.createGroup({
    leader: { name: "Alice Johnson", studentId: "S1001", role: "leader" },
    members: [
      { name: "Bob Smith", studentId: "S1002", role: "member" },
      { name: "Charlie Brown", studentId: "S1003", role: "member" },
      { name: "David Wilson", studentId: "S1004", role: "member" },
      { name: "Eve Davis", studentId: "S1005", role: "member" },
      { name: "Frank Miller", studentId: "S1006", role: "member" },
      { name: "Grace Lee", studentId: "S1007", role: "member" },
    ],
  });

  const group2 = await storage.createGroup({
    leader: { name: "Henry Ford", studentId: "S2001", role: "leader" },
    members: [
      { name: "Ivy Thomas", studentId: "S2002", role: "member" },
      { name: "Jack White", studentId: "S2003", role: "member" },
      { name: "Kelly Green", studentId: "S2004", role: "member" },
      { name: "Liam Scott", studentId: "S2005", role: "member" },
      { name: "Mia Clark", studentId: "S2006", role: "member" },
      { name: "Noah Hall", studentId: "S2007", role: "member" },
    ],
  });

  console.log("Seeding complete!");
}

seed().catch(console.error);
