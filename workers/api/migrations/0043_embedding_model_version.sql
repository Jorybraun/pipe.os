-- Add embedding_model_version to tables that store embeddings
ALTER TABLE candidate_ingestion ADD COLUMN embedding_model_version TEXT;
ALTER TABLE role_contexts ADD COLUMN embedding_model_version TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN embedding_model_version TEXT;

-- Backfill existing rows with the current model version
UPDATE candidate_ingestion SET embedding_model_version = '@cf/baai/bge-large-en-v1.5' WHERE embedding_json IS NOT NULL;
UPDATE role_contexts SET embedding_model_version = '@cf/baai/bge-large-en-v1.5' WHERE embedding_json IS NOT NULL;
UPDATE repo_engineering_signals SET embedding_model_version = '@cf/baai/bge-large-en-v1.5' WHERE embedding_json IS NOT NULL;
