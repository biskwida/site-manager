// test/store-memory.test.ts
import { InMemoryStore } from "@/src/store/memory";
import { storeContract } from "./store-contract";

storeContract("memory", async () => new InMemoryStore(), async (s, path) => (s as InMemoryStore).files.has(path));
