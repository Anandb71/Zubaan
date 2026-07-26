import "server-only";

import { createClient } from "@supabase/supabase-js";

import { config } from "@/lib/config";
import type { RepositoryBundle } from "@/lib/repositories/contracts";
import { createMemoryRepositories } from "@/lib/repositories/memory";
import { SupabaseRepositories } from "@/lib/repositories/supabase";

function buildRepositories(): RepositoryBundle {
  if (
    config.storage.mode === "supabase" &&
    config.storage.url &&
    config.storage.serviceKey
  ) {
    const client = createClient(config.storage.url, config.storage.serviceKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: {
          "X-Client-Info": "zubaan-server/0.2",
        },
      },
    });
    return new SupabaseRepositories(client);
  }
  return createMemoryRepositories();
}

declare global {
  var __zubaanRepositories: RepositoryBundle | undefined;
}

export const repositories =
  globalThis.__zubaanRepositories ?? buildRepositories();

if (process.env.NODE_ENV !== "production") {
  globalThis.__zubaanRepositories = repositories;
}

export type {
  ClaimEventResult,
  ComplianceRepository,
  ConversationQuery,
  ConversationRepository,
  IngestionRepository,
  OrganizationScope,
  PrivateBucket,
  PrivateObjectRepository,
  PutMessageInput,
  PutMessageResult,
  PutPrivateObjectInput,
  RepositoryBundle,
  StoredObject,
  WriteDisposition,
  WriteResult,
} from "@/lib/repositories/contracts";
