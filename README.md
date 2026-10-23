# CoEvolution Orchestrator — Backend API

> Node.js REST API for the CoEvolution AEGIS Testbed. Handles AI model registration and versioning, tool registration, file storage across MinIO pools, report aggregation, AI-MBOM generation requests, and real-time event streaming via Kafka.

[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-black)](https://expressjs.com)
[![Mongoose](https://img.shields.io/badge/Mongoose-9-green)](https://mongoosejs.com)
[![Kafka](https://img.shields.io/badge/Kafka-KafkaJS-orange)](https://kafka.js.org)
[![MinIO](https://img.shields.io/badge/MinIO-8-red)](https://min.io)
[![Keycloak](https://img.shields.io/badge/Keycloak-26-blue)](https://keycloak.org)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [API Reference](#api-reference)
  - [Authentication](#authentication)
  - [Models](#models)
  - [Reports](#reports)
  - [AI-MBOM](#ai-mbom)
  - [Files](#files)
  - [Tools](#tools)
  - [Users](#users)
- [Data Models](#data-models)
- [Pipeline Flow](#pipeline-flow)
- [MinIO Pools](#minio-pools)
- [Pilot Buckets](#pilot-buckets)
- [Kafka Topics](#kafka-topics)
- [Deployment](#deployment)
- [Platform URLs](#platform-urls)

---

## Overview

The CoEvolution Orchestrator is the backend of the AEGIS Testbed. It acts as the central hub connecting:

- The **Angular UI** (user-facing dashboard)
- **MinIO** (file storage — 5 separate pools)
- **MongoDB** (metadata for models, files, tools and users)
- **Kafka** (real-time events to partner engines: RAGRE, STRAE, assessment/defence engines)
- **Keycloak** (JWT authentication)

Main responsibilities:

- Register AI models and their versions
- Upload files (up to 20 per request) to any MinIO pool/bucket and keep their metadata in MongoDB
- Automatically link uploaded reports to the matching model version
- Publish Kafka events when partner engines need to act
- Aggregate reports per model / version / owner
- Request AI-MBOM generation (full or incremental) from STRAE
- Keep a registry of assessment / defence / generator tools
- Restrict pilot partners to their own data buckets

---

## Architecture

```
Angular UI / Partner engines
    │  HTTPS (Bearer token from Keycloak)
    ▼
Node.js Backend (port 4000)
    │
    ├── MongoDB          ← models, files, tools, users metadata
    ├── MinIO (5 pools)  ← the actual files
    └── Kafka            ← events to partner engines
```

Startup order (`backend/src/index.js`):

1. **MongoDB** — required. If it fails, the process exits.
2. **MinIO** — connects to all 5 pools and creates missing buckets. 
3. **Kafka** — connects the producer. 
4. **Express** — starts on `PORT` (default `4000`). Request timeout is set to **20 minutes** so large uploads are not cut off.

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js   | 20      | Runtime (ES modules) |
| Express   | 5       | HTTP framework |
| Mongoose  | 9       | MongoDB ODM |
| MinIO SDK | 8       | S3-compatible file storage |
| KafkaJS   | 2       | Kafka producer / admin |
| jsonwebtoken + jwks-rsa | 9 / 4 | Keycloak JWT verification |
| Multer    | 2       | Multipart uploads (stored to OS temp dir, then streamed to MinIO) |
| UUID      | 13      | Auto-generate model UUIDs |
| swagger-ui-express + js-yaml | 5 / 4 | API documentation |
| nodemon   | 3       | Dev auto-reload |

---

## Project Structure

```
Orchestrator_T6.1/
├── backend/
│   └── src/
│       ├── index.js                      ← entry point — connects services, starts server
│       ├── app.js                        ← Express setup, routes, Swagger
│       ├── config/
│       │   ├── constants.js              ← DB name
│       │   ├── database.js               ← MongoDB connection
│       │   ├── minio.js                  ← MinIO pool clients + bucket init
│       │   ├── kafka.js                  ← Kafka producer + publishEvent()
│       │   └── pilot.js                  ← Keycloak user ID → pilot bucket map
│       ├── controllers/
│       │   ├── model.controller.js       ← models, versions, reports, AI-MBOM
│       │   ├── minio.controller.js       ← file upload/download/search/list/delete
│       │   ├── tools.controller.js       ← tool registry
│       │   └── user.controller.js        ← local user register/login/logout 
│       ├── middleware/
│       │   ├── keycloak.middleware.js    ← requireAuth, optionalAuth
│       │   └── pilotBucket.middleware.js ← restrictPilotBucket
│       ├── models/
│       │   ├── models.model.js           ← Model schema (with versioning)
│       │   ├── file.model.js             ← File schema
│       │   ├── tools.model.js            ← Tool schema
│       │   └── user.model.js             ← User schema
│       └── routes/
│           ├── models.routes.js          ← /api/v1/models
│           ├── files.routes.js           ← /api/v1/files
│           ├── tools.routes.js           ← /api/v1/tools
│           └── user.routes.js            ← /api/v1/users
├── docs/
│   ├── swagger.yaml                      ← OpenAPI spec served at /api/docs
│   ├── CoevolutionSwagger.yaml
│   ├── CoevolutionSwagger2.yaml
│   ├── model_DM.json                     ← model data model example
│   ├── report_DM.json                    ← report data model example
│   └── report_w_defence_DM.json          ← report with defence data model example
├── .env                                  ← local development config (not in git)
├── .gitignore
├── Dockerfile
├── package.json
└── .github/
    └── workflows/
        └── docker-build.yml              ← CI/CD: build and push Docker image
```

---

## Prerequisites

- Node.js 20+
- npm
- Access to a MongoDB instance
- Access to the 5 MinIO pools (SAP, RP, TRP, AP, STRDP)
- Access to the Kafka broker (optional — the server runs without it)
- A Keycloak account on the `coevolution` realm (for protected routes)

---

## Environment Variables

In development, variables are read from `.env` in the project root. When `NODE_ENV=production` (Kubernetes), `.env` is **not** loaded — variables come from the `backend-secret` instead.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | — | Set to `production` to skip loading `.env` |
| `PORT` | No | `4000` | HTTP port |
| `MONGODB_URI` | Yes | — | MongoDB connection string |
| `KAFKA_BROKER` | No | `147.102.19.168:30004` | Kafka broker `host:port` |
| `MINIO_SAP_HOST` / `MINIO_SAP_PORT` | No | `147.102.19.168` / `30005` | SAP pool endpoint |
| `MINIO_SAP_USER` / `MINIO_SAP_PASS` | Yes | — | SAP pool credentials |
| `MINIO_RP_HOST` / `MINIO_RP_PORT` | No | `147.102.19.168` / `30006` | RP pool endpoint |
| `MINIO_RP_USER` / `MINIO_RP_PASS` | Yes | — | RP pool credentials |
| `MINIO_TRP_HOST` / `MINIO_TRP_PORT` | No | `147.102.19.168` / `30007` | TRP pool endpoint |
| `MINIO_TRP_USER` / `MINIO_TRP_PASS` | Yes | — | TRP pool credentials |
| `MINIO_AP_HOST` / `MINIO_AP_PORT` | No | `147.102.19.168` / `30008` | AP pool endpoint |
| `MINIO_AP_USER` / `MINIO_AP_PASS` | Yes | — | AP pool credentials |
| `MINIO_STRDP_HOST` / `MINIO_STRDP_PORT` | No | `147.102.19.168` / `30009` | STRDP pool endpoint |
| `MINIO_STRDP_USER` / `MINIO_STRDP_PASS` | Yes | — | STRDP pool credentials |

Example `.env`:

```env
MONGODB_URI=mongodb://<user>:<pass>@<host>:<port>/coevolution
PORT=4000

MINIO_SAP_USER=...
MINIO_SAP_PASS=...
MINIO_RP_USER=...
MINIO_RP_PASS=...
MINIO_TRP_USER=...
MINIO_TRP_PASS=...
MINIO_AP_USER=...
MINIO_AP_PASS=...
MINIO_STRDP_USER=...
MINIO_STRDP_PASS=...

KAFKA_BROKER=<host>:<port>
```

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Create .env (see above)

# 3. Run in development (auto-reload)
npm run dev

# or run normally
npm start
```

The API is then available at `http://localhost:4000/api/v1` and Swagger at `http://localhost:4000/api/docs`.

### Run with Docker

```bash
docker build -t orchestrator_t6.1 .
docker run -p 4000:4000 --env-file .env orchestrator_t6.1
```

---

## API Reference

Full interactive documentation:

```
https://aegis.coevolution-project.eu/api/docs
```

Base path: `/api/v1`

### Authentication

Protected routes require a Bearer token from Keycloak (realm `coevolution`, audience `account`). The token is verified against the Keycloak JWKS endpoint, and the user's `username`, `email`, `sub` and realm `roles` are attached to `req.user`.

**Get a token:**

```bash
curl -X POST https://aegis.coevolution-project.eu/realms/coevolution/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=..." \
  --data-urlencode "client_id=..." \
  --data-urlencode "username=..." \
  --data-urlencode 'password=...'
```

Use the `access_token` from the response as:

```
Authorization: Bearer <access_token>
```

---

### Models

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/models` | No | Get all models (optional `?owner=<username>`) |
| GET    | `/models/:uuid` | No | Get model by UUID |
| POST   | `/models/register` | Yes | Register new model |
| POST   | `/models/:uuid/versions` | Yes | Add a new version |
| PATCH  | `/models/:uuid/versions/:version/requirements-url` | Yes | Update requirements URL of a version |
| PATCH  | `/models/:uuid/versions/:version/security` | Yes | Update `defences`, `assessments`, `risk_assessment_reports`, `trusted` |

**Register model — request body:**

```json
{
  "name": "MySecurityModel",
  "type": "classification",
  "model_paradigm": "supervised",
  "architecture_family": "cnn",
  "framework": "pytorch",
  "input_modality": ["image"],
  "versioning": [
    { "version": "v1.0", "description": "Initial version" }
  ]
}
```

- Required: `name`, `type`, `versioning`.
- `owner` is taken from the Keycloak token and `model_uuid` is auto-generated — do not send them.
- The model named `automotive_model_P2` always gets the fixed UUID `d1054483-3d4a-43c0-a181-d7ecff862b2d`.

**Add version — request body:**

```json
{ "version": "v1.1", "description": "Retrained", "trusted": false }
```

---

### Reports

Reports are the files linked to a model version (see [Data Models](#data-models)). Each response item includes a `download_url`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/models/:uuid/versions/:version/reports?type=<type>` | No | Reports of one type for a single model version |
| GET    | `/models/reports?type=<type>[&uuid=][&version=][&owner=]` | No | Reports of one type across models, filtered by UUID / version / owner |

**Supported `type` values:**

| type | Version field |
|------|---------------|
| `requirements` | `requirements` |
| `trusted-model` | `trusted_model` (only on `/models/reports`) |
| `risk` | `risk_assessment_reports` |
| `assessment` | `assessments` |
| `defence` | `defences` |
| `gadgets` | `gadgets_reports` |
| `aimodelinfo` | `aimodelinfo_reports` |
| `euaiact` | `euaiact_reports` |
| `datasets` | `datasets_reports` |
| `aimbom` | `ai_mbom` |
| `user-assessment` | `user_assessments` |
| `user-defence` | `user_defences` |

**Examples:**

```
GET /api/v1/models/<uuid>/versions/v1.0/reports?type=risk
GET /api/v1/models/reports?type=aimbom&owner=coevolution_user
GET /api/v1/models/reports?type=risk&uuid=<uuid>&version=v1.0
```

---

### AI-MBOM

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/models/:uuid/versions/:version/aimbom` | Yes | Request AI-MBOM generation from STRAE |

Behaviour:

1. Takes the **latest** file of each report type for that version (risk, assessment, defence, gadgets, aimodelinfo, euaiact, datasets, aimbom).
2. If the required reports are missing → `404 No reports found for this model version.`
3. If **no AI-MBOM exists yet** → publishes `aimbom-requested` to the `strae` topic with all latest reports.
4. If an **AI-MBOM already exists** → publishes `updated-aimbom-requested` to `strae` with only the reports created after the last AI-MBOM (`changedReports`).

---

### Files

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/files/upload` | Yes | Upload up to 20 files to a pool/bucket |
| GET    | `/files` | No | List files (optional `?pool=&bucket=`) |
| GET    | `/files/search` | No | Search files (`?model_uuid=&version=&report_type=`) |
| GET    | `/files/download/:id` | No | Download file by MongoDB ID |
| GET    | `/files/url/:id` | Yes | Get presigned URL (valid 1 hour) |
| DELETE | `/files/:id` | Yes | Delete file from MinIO and MongoDB |

**Upload — form-data:**

```
files      → one or more files (field name "files", max 20)
pool       → RP
bucket     → risk-reports
model_uuid → 550e8400-e29b-41d4-a716-446655440000
version    → v1.0
tags       → risk,Q1,security   (optional, comma-separated)
```

Upload rules:

- `pool` and `bucket` are always required. The bucket must already exist in that pool.
- `model_uuid` and `version` are required, **except** for data buckets: `trusted-data`, `siemens-data`, `avl-data`, `avi-data`.
- Files are written to the OS temp directory by Multer, streamed to MinIO, then the temp file is deleted (no files held in RAM).
- **Same file name** for the same model version and bucket → stored with a suffix, e.g. `report.pdf`, `report_01.pdf`, `report_02.pdf`. The original name is kept in `filename`.
- **Auto-linking:** if the bucket is a report bucket, the new file IDs are pushed into the matching version field:

  | Bucket | Version field |
  |--------|---------------|
  | `model-requirements` | `requirements` |
  | `risk-reports` | `risk_assessment_reports` |
  | `assessment-reports` | `assessments` |
  | `defence-reports` | `defences` |
  | `gadgets-reports` | `gadgets_reports` |
  | `aimodelinfo-reports` | `aimodelinfo_reports` |
  | `euaiact-reports` | `euaiact_reports` |
  | `datasets-reports` | `datasets_reports` |
  | `ai-mbom` | `ai_mbom` |
  | `user-assessments` | `user_assessments` |
  | `user-defences` | `user_defences` |
  | `trusted-models` | `trusted_model` (also sets the version `trusted = true`) |

- **Kafka:** uploads to some buckets publish an event (see [Kafka Topics](#kafka-topics)). A Kafka failure does not fail the upload.
- **Pilot restriction:** see [Pilot Buckets](#pilot-buckets).

**Search — `report_type` values:**

| report_type | Pool / Bucket |
|-------------|---------------|
| `risk` | RP / risk-reports |
| `assessment` | RP / assessment-reports |
| `defence` | RP / defence-reports |
| `gadgets` | RP / gadgets-reports |
| `aimodelinfo` | RP / aimodelinfo-reports |
| `euaiact` | RP / euaiact-reports |
| `datasets` | RP / datasets-reports |
| `requirements` | TRP / model-requirements |
| `aimbom` | SAP / ai-mbom |
| `data` | TRP / trusted-data |

---

### Tools

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/tools` | No | List tools (optional `?tool_type=`) |
| GET    | `/tools/:tool_id` | No | Get tool by `tool_id` |
| POST   | `/tools/register` | Yes | Register a tool |
| DELETE | `/tools/:tool_id` | Yes | Delete a tool |

**Register tool — request body:**

```json
{
  "tool_id": "TOOL-001",
  "name": "My Assessment Tool",
  "description": "Evasion robustness assessment",
  "tool_type": "assessment",
  "github_url": "https://github.com/org/tool",
  "defence_flows": ["adversarial-training"],
  "attacks_vulnerabilities": ["evasion", "poisoning"],
  "tags": ["robustness"]
}
```

- Required: `tool_id` (unique), `name`, `tool_type`, `github_url`.
- `tool_type` ∈ `assessment`, `assessment_with_defence`, `defence`, `data_generator`, `gadgets`.
- `uploadedBy` is taken from the Keycloak token.
- Duplicate `tool_id` → `400`.

---

### Users

Local users stored in MongoDB (password hashed with bcrypt). The UI and partners authenticate through Keycloak; these routes are separate from it.

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| POST   | `/users/register` | No | `username`, `email`, `password` |
| POST   | `/users/login` | No | `email`, `password` |
| POST   | `/users/logout` | No | `email` |

---

## Data Models

### Model

| Field | Type | Notes |
|-------|------|-------|
| `name` | String | required |
| `model_uuid` | String | unique, auto-generated |
| `owner` | String | Keycloak username |
| `type` | String | required |
| `model_paradigm` | String | |
| `architecture_family` | String | |
| `framework` | String | |
| `input_modality` | [String] | |
| `versioning` | [Version] | required |

### Version (inside `versioning`)

| Field | Type | Notes |
|-------|------|-------|
| `version` | String | required |
| `description` | String | |
| `trusted` | Boolean | default `false`; set `true` on upload to `trusted-models` |
| `requirements` | [FileId] | |
| `risk_assessment_reports` | [FileId] | |
| `assessments` | [FileId] | |
| `defences` | [FileId] | |
| `gadgets_reports` | [FileId] | |
| `aimodelinfo_reports` | [FileId] | |
| `euaiact_reports` | [FileId] | |
| `datasets_reports` | [FileId] | |
| `ai_mbom` | [FileId] | |
| `user_assessments` | [FileId] | |
| `user_defences` | [FileId] | |
| `trusted_model` | [FileId] | |

### File

`pool` (SAP/RP/TRP/AP/STRDP), `bucket`, `objectKey` (name in MinIO), `filename` (original name), `size`, `contentType`, `uploadedBy`, `tags`, `createdAt`, `updatedAt`.

### Tool

`tool_id`, `name`, `description`, `tool_type`, `github_url`, `defence_flows`, `attacks_vulnerabilities`, `uploadedBy`, `tags`, `createdAt`, `updatedAt`.

Example documents are in [docs/](docs/) (`model_DM.json`, `report_DM.json`, `report_w_defence_DM.json`).

---

## Pipeline Flow

```
1. User registers model            POST /models/register
2. User uploads requirements       POST /files/upload  (TRP / model-requirements)
        → linked to version.requirements
        → Kafka: ragre_models                         → RAGRE engine
3. Engines upload their reports    POST /files/upload  (RP / risk-reports, assessment-reports,
                                                        defence-reports, gadgets-reports, ...)
        → linked to the matching version field
4. User uploads own assessment /   POST /files/upload  (user-assessments / user-defences)
   defence results                 → Kafka: assessment_reports / defence_reports
5. User reads reports              GET  /models/:uuid/versions/:version/reports?type=...
                                   GET  /files/download/:id
6. User requests AI-MBOM           POST /models/:uuid/versions/:version/aimbom
        → Kafka: strae (aimbom-requested / updated-aimbom-requested) → STRAE
7. STRAE uploads AI-MBOM           POST /files/upload  (SAP / ai-mbom)
        → linked to version.ai_mbom
```

**Example — step 2:**

```bash
curl -X POST https://aegis.coevolution-project.eu/api/v1/files/upload \
  -H "Authorization: Bearer <token>" \
  -F "files=@requirements.txt" \
  -F "pool=TRP" \
  -F "bucket=model-requirements" \
  -F "model_uuid=<uuid>" \
  -F "version=v1.0"
```

---

## MinIO Pools

| Pool  | Full name | Internal service | External port | Console URL |
|-------|-----------|-----------------|---------------|-------------|
| SAP   | Security Assurance Pool | `minio-sap-svc:9000` | 30005 | `/sap/` |
| RP    | Report Pool | `minio-rp-svc:9000` | 30006 | `/rp/` |
| TRP   | Trust Resources Pool | `minio-trp-svc:9000` | 30007 | `/trp/` |
| AP    | Assessment Pool | `minio-ap-svc:9000` | 30008 | `/ap/` |
| STRDP | Security Trust Robustness Defence | `minio-strdp-svc:9000` | 30009 | `/strdp/` |

### Buckets created automatically on startup

| Pool  | Buckets |
|-------|---------|
| SAP   | `ai-mbom` |
| RP    | `risk-reports`, `assessment-reports`, `defence-reports`, `user-assessment-reports`, `user-defence-reports`, `gadgets-reports`, `aimodelinfo-reports`, `euaiact-reports`, `datasets-reports` |
| TRP   | `trusted-data`, `model-requirements` |
| AP    | `assessment-libraries`, `assessment-tools` |
| STRDP | `defence-libraries`, `design-train-defence-tools`, `deployment-test-defence-tools` |

Other buckets used by the code (`user-assessments`, `user-defences`, `trusted-models`, and the pilot buckets) are **not** created on startup and must already exist in the target pool — otherwise the upload returns `404 Bucket does not exist`.

---

## Pilot Buckets

Pilot partners are mapped by their Keycloak user ID (`sub`) in [backend/src/config/pilot.js](backend/src/config/pilot.js):

| Bucket |
|--------|
| `siemens-data` |
| `avl-data` |
| `avi-data` |

Rules applied on `POST /files/upload` (`restrictPilotBucket`):

1. A pilot user can upload **only** to their own bucket → anything else returns `403`.
2. A non-pilot user **cannot** upload to any pilot bucket → `403`.
3. Everyone else uploads normally.

Pilot buckets are data buckets, so `model_uuid` and `version` are not required.

---

## Kafka Topics

`publishEvent()` checks that the topic exists first. If it doesn't, the event is not sent — **create topics in Kafdrop beforehand**.

| Topic | Published when | Event | Consumer |
|-------|---------------|-------|----------|
| `ragre_models` | Upload to `model-requirements` | `ragre_models` | RAGRE engine |
| `assessment_reports` | Upload to `user-assessments` | `assessment_reports` | Assessment engine |
| `defence_reports` | Upload to `user-defences` | `defence_reports` | Defence engine |
| `strae` | `POST /models/:uuid/versions/:version/aimbom` | `aimbom-requested` / `updated-aimbom-requested` | STRAE |

**Upload event payload:**

```json
{
  "event": "ragre_models",
  "model_name": "MyModel",
  "model_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "version": "v1.0",
  "uploadedBy": "coevolution_user",
  "uploadedAt": "2026-04-24T10:00:00.000Z",
  "pool": "TRP",
  "tags": [],
  "total_files": 1,
  "files": [
    {
      "_id": "6a5f54f244211ea5d45be601",
      "bucket": "model-requirements",
      "filename": "requirements.txt",
      "download_url": "https://aegis.coevolution-project.eu/api/v1/files/download/6a5f54f244211ea5d45be601"
    }
  ]
}
```

**AI-MBOM event payload (`strae`):**

```json
{
  "event": "aimbom-requested",
  "model_name": "MyModel",
  "model_uuid": "550e8400-e29b-41d4-a716-446655440000",
  "version": "v1.0",
  "requestedBy": "coevolution_user",
  "requestedAt": "2026-04-24T10:00:00.000Z",
  "reports": {
    "risk_report":        { "_id": "...", "bucket": "risk-reports", "filename": "...", "download_url": "...", "createdAt": "..." },
    "assessment_report":  { "...": "..." },
    "defence_report":     { "...": "..." },
    "gadgets_report":     { "...": "..." },
    "aimodelinfo_report": { "...": "..." },
    "euaiact_report":     { "...": "..." },
    "datasets_report":    { "...": "..." },
    "aimbom_report":      null
  }
}
```

For `updated-aimbom-requested`, `reports` is replaced by `changedReports`, containing only the reports created since the last AI-MBOM.

**Subscribe to a topic (Node.js):**

```js
import { Kafka } from 'kafkajs'

const kafka = new Kafka({
  clientId: 'partner-server',
  brokers: ['147.102.19.168:30004'],
})

const consumer = kafka.consumer({ groupId: 'my-partner-group' })

await consumer.connect()
await consumer.subscribe({ topic: 'ragre_models', fromBeginning: false })

await consumer.run({
  eachMessage: async ({ message }) => {
    const event = JSON.parse(message.value.toString())
    for (const file of event.files) {
      console.log('New file:', file.download_url)
    }
  }
})
```

**Subscribe to a topic (Python):**

```python
from kafka import KafkaConsumer
import json

consumer = KafkaConsumer(
    'ragre_models',
    bootstrap_servers=['147.102.19.168:30004'],
    group_id='my-partner-group',
    auto_offset_reset='latest',
    value_deserializer=lambda m: json.loads(m.decode('utf-8'))
)

for message in consumer:
    event = message.value
    for f in event['files']:
        print('New file:', f['download_url'])
```

---

## Deployment

The backend is deployed on a Kubernetes cluster (kind). In the cluster, `NODE_ENV=production` and the environment variables come from `backend-secret`.

### CI/CD Pipeline

`.github/workflows/docker-build.yml`:

- **Push to `main`** → builds the Docker image and pushes it to `ghcr.io/coevolution-project-eu/orchestrator_t6.1` with tags `latest` and `sha-<commit>`.
- **Pull request to `main`** → builds only (no push).

After a new image is pushed, restart the backend pod to pick it up.

### Timeouts

Node's `requestTimeout` is 20 minutes (`headersTimeout` slightly higher) so large uploads through nginx are not killed by Node's 5-minute default. Keep the nginx proxy timeout aligned with this.

---

## Platform URLs

| Service | URL | Credentials |
|---------|-----|-------------|
| Angular UI | https://aegis.coevolution-project.eu/fvt/ | Keycloak login |
| Swagger API docs | https://aegis.coevolution-project.eu/api/docs | Public |
| Keycloak admin | https://aegis.coevolution-project.eu/admin/ |  |
| MinIO SAP | https://aegis.coevolution-project.eu/sap/ |  |
| MinIO RP | https://aegis.coevolution-project.eu/rp/ |  |
| MinIO TRP | https://aegis.coevolution-project.eu/trp/ |  |
| MinIO AP | https://aegis.coevolution-project.eu/ap/ |  |
| MinIO STRDP | https://aegis.coevolution-project.eu/strdp/ |  |
| Kafdrop | https://aegis.coevolution-project.eu/kafdrop/ | Public |
| MongoDB UI | https://aegis.coevolution-project.eu/mongo/ |  |

---

## License

CoEvolution Project EU

## Author

**Konstantinos Krouti**
GitHub: (https://github.com/kostaskr13)
