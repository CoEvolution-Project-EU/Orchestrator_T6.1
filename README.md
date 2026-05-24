# CoEvolution Orchestrator — Backend API

> Node.js REST API for the CoEvolution AEGIS Testbed. Handles AI model registration, file storage across MinIO pools, and real-time event streaming via Kafka.

[![Node.js](https://img.shields.io/badge/Node.js-20-green)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-black)](https://expressjs.com)
[![MongoDB](https://img.shields.io/badge/MongoDB-9-green)](https://mongodb.com)
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
- [Four-Step Flow](#four-step-flow)
- [MinIO Pools](#minio-pools)
- [Kafka Topics](#kafka-topics)
- [Deployment](#deployment)
- [Platform URLs](#platform-urls)

---

## Overview

The CoEvolution Orchestrator is the backend of the AEGIS Testbed. It acts as the central hub connecting:

- The **Angular UI** (user-facing dashboard)
- **MinIO** (file storage — 5 separate pools)
- **MongoDB** (metadata storage)
- **Kafka** (real-time event streaming)
- **Keycloak** (authentication and authorization)

---

## Architecture

```
Angular UI
    │  HTTPS
    ▼
Node.js Backend (port 4000)
    │
    ├── MongoDB          ← stores model metadata and file metadata
    ├── MinIO (5 pools)  ← stores actual files
    └── Kafka            ← publishes events to notify partners
```

### Four-Step Pipeline

```
Step 1 — User registers model + uploads requirements file
         → MinIO TRP/model-requirements
         → MongoDB: models + files collections
         → Kafka: ragre_models
                  ↓
Step 2 — RAGRE engine downloads requirements, processes, uploads risk report
         → MinIO RP/risk-reports
         → MongoDB: files collection
                  ↓
Step 3 — User downloads risk report
         → MinIO RP/risk-reports (download)
                  ↓
Step 4 — User uploads final assessment report
         → MinIO RP/assessment-reports
         → MongoDB: files collection
         → Kafka: assessment-uploaded
```

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js   | 20      | Runtime |
| Express   | 5       | HTTP framework |
| MongoDB   | 9       | Model and file metadata |
| Mongoose  | 9       | MongoDB ODM |
| MinIO     | 8       | S3-compatible file storage |
| KafkaJS   | 2       | Kafka producer |
| Keycloak  | 26      | JWT authentication |
| Multer    | 2       | File upload handling |
| UUID      | 13      | Auto-generate model UUIDs |
| Swagger UI| latest  | API documentation |

---

## Project Structure

```
Orchestrator_T6.1/
├── backend/
│   └── src/
│       ├── index.js                  ← entry point — starts everything
│       ├── app.js                    ← Express setup, routes, Swagger
│       ├── config/
│       │   ├── database.js           ← MongoDB connection
│       │   ├── minio.js              ← MinIO pool connections
│       │   └── kafka.js              ← Kafka producer + publishEvent()
│       ├── controllers/
│       │   ├── model.controller.js   ← model CRUD + requirements upload
│       │   ├── minio.controller.js   ← file upload/download/search/delete
│       │   └── user.controller.js    ← user register/login/logout
│       ├── middleware/
│       │   └── keycloak.middleware.js← requireAuth, optionalAuth
│       ├── models/
│       │   ├── models.model.js       ← Model schema (MongoDB)
│       │   ├── file.model.js         ← File schema (MongoDB)
│       │   └── user.model.js         ← User schema (MongoDB)
│       └── routes/
│           ├── models.routes.js      ← /api/v1/models
│           ├── files.routes.js       ← /api/v1/files
│           └── user.routes.js        ← /api/v1/users
├── docs/
│   └── swagger.yaml                  ← OpenAPI 3.0 specification
├── .env                              ← local development config (not in git)
├── .gitignore
├── Dockerfile
├── package.json
└── .github/
    └── workflows/
        └── docker-build.yml          ← CI/CD: build and push Docker image
```

---

## Prerequisites

- Node.js 20+


---

## Getting Started



## API Reference

Full interactive documentation is available at:

```
https://aegis.coevolution-project.eu/api/docs
```

### Authentication

Protected routes require a Bearer token from Keycloak.

**Get a token:**

```bash
curl -X POST https://aegis.coevolution-project.eu/realms/coevolution/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=..." \
  --data-urlencode "client_id=..." \
  --data-urlencode "username=..." \
  --data-urlencode 'password=...'
```

Copy the `access_token` from the response and use it as:
```
Authorization: Bearer <access_token>
```

---

### Models

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/api/v1/models` | No | Get all models |
| GET    | `/api/v1/models/:uuid` | No | Get model by UUID |
| POST   | `/api/v1/models/register` | Yes | Register new model |
| POST   | `/api/v1/models/:uuid/versions` | Yes | Add new version |

**Register model — request body:**
```json
{
  "name": "MySecurityModel",
  "type": "classification",
  "versioning": [
    {
      "version": "v1.0",
      "description": "Initial version"
    }
  ]
}
```

> `owner` and `model_uuid` are set automatically — do not send them.

---

### Requirements

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/api/v1/models/:uuid/versions/:version/requirements` | Yes | Upload requirements file |
| GET    | `/api/v1/models/:uuid/versions/:version/requirements/download?pool=&bucket=` | No | Download requirements file |
| PATCH  | `/api/v1/models/:uuid/versions/:version/requirements-url` | Yes | Update requirements URL |

**Upload requirements — form-data:**
```
file   → the requirements file
pool   → TRP
bucket → model-requirements
```


---

### Files

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST   | `/api/v1/files/upload` | Yes | Upload file to any pool/bucket |
| GET    | `/api/v1/files` | No | List files (filter by pool/bucket) |
| GET    | `/api/v1/files/search` | No | Search files |
| GET    | `/api/v1/files/download/:id` | No | Download file by MongoDB ID |
| GET    | `/api/v1/files/url/:id` | Yes | Get presigned URL (1 hour) |
| DELETE | `/api/v1/files/:id` | Yes | Delete file |

**Upload file — form-data:**
```
file       → the file
pool       → RP
bucket     → risk-reports
model_uuid → 550e8400-e29b-41d4-a716-446655440000
version    → v1.0
tags       → risk,Q1,security  (optional, comma-separated)
```

**Search files — query params:**
```
GET /api/v1/files/search?model_uuid=...&pool=RP&bucket=risk-reports&uploadedBy=ragre&from=2026-01-01
```


---

## Four-Step Flow

### Step 1 — User uploads requirements

```bash
# 1. Register model
POST /api/v1/models/register
Authorization: Bearer <token>
{
  "name": "MyModel",
  "type": "classification",
  "versioning": [{ "version": "v1.0" }]
}

# 2. Upload requirements file
POST /api/v1/models/<uuid>/versions/v1.0/requirements
Authorization: Bearer <token>
form-data: file=requirements.txt, pool=TRP, bucket=model-requirements
```

Kafka publishes: `ragre_models`

### Step 2 — RAGRE uploads risk report

```bash
POST /api/v1/files/upload
Authorization: Bearer <ragre-token>
form-data: file=risk-report.pdf, pool=RP, bucket=risk-reports, model_uuid=<uuid>, version=v1.0
```

Kafka publishes: `risk-report-ready` // not implemenent yet

### Step 3 — User downloads risk report

```bash
GET /api/v1/files/download/<file-id>
```

### Step 4 — User uploads assessment

```bash
POST /api/v1/files/upload
Authorization: Bearer <token>
form-data: file=assessment.pdf, pool=RP, bucket=assessment-reports, model_uuid=<uuid>, version=v1.0
```

Kafka publishes: `assessment-uploaded`

---

## MinIO Pools

| Pool  | Full name | Internal service | External port | Console URL |
|-------|-----------|-----------------|---------------|-------------|
| SAP   | Security Assurance Pool | `minio-sap-svc:9000` | 30005 | `/sap/` |
| RP    | Report Pool | `minio-rp-svc:9000` | 30006 | `/rp/` |
| TRP   | Trust Resources Pool | `minio-trp-svc:9000` | 30007 | `/trp/` |
| AP    | Assessment Pool | `minio-ap-svc:9000` | 30008 | `/ap/` |
| STRDP | Security Trust Robustness Defence | `minio-strdp-svc:9000` | 30009 | `/strdp/` |

### Buckets

| Pool  | Bucket | Purpose |
|-------|--------|---------|
| SAP   | ai-mbom |  |
| RP    | risk-reports |  |
| RP    | assessment-reports |  |
| RP    | defence-reports |  |
| TRP   | trusted-data |  |
| TRP   | model-requirements |  |
| AP    | assessment-libraries | |
| AP    | assessment-tools |  |
| STRDP | defence-libraries |  |
| STRDP | design-train-defence-tools |  |
| STRDP | deployment-test-defence-tools |  |

---

## Kafka Topics

| Topic | Published when | Consumer |
|-------|---------------|----------|
| `ragre_models` | User uploads requirements file | RAGRE engine |
| `risk-report-ready` | RAGRE uploads risk report | Angular UI | // not implemenent yet
| `assessment-uploaded` | User uploads assessment report | RAGRE engine | // not implemenent yet

**Event payload example:**
```json
{
  "event": "ragre_models",
  "modelName": "MyModel",
  "modelUuid": "550e8400-e29b-41d4-a716-446655440000",
  "version": "v1.0",
  "pool": "TRP",
  "bucket": "model-requirements",
  "filename": "requirements.txt",
  "requirements_url": "https://aegis.coevolution-project.eu/api/v1/models/.../requirements/download?pool=TRP&bucket=model-requirements",
  "uploadedAt": "2026-04-24T10:00:00.000Z"
}
```

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
    console.log('New requirements file:', event.requirements_url)
  }
})
```

**Subscribe to a topic (Python):**
```python
from kafka import KafkaConsumer
import json

consumer = KafkaConsumer(
    'requirements-uploaded',
    bootstrap_servers=['147.102.19.168:30004'],
    group_id='my-partner-group',
    auto_offset_reset='latest',
    value_deserializer=lambda m: json.loads(m.decode('utf-8'))
)

for message in consumer:
    event = message.value
    print('New requirements file:', event['requirements_url'])
```
---

## Deployment

The backend is deployed on a Kubernetes cluster (kind) .

### CI/CD Pipeline

Every push to `main` triggers GitHub Actions:

1. Builds Docker image
2. Pushes to `ghcr.io/coevolution-project-eu/orchestrator_t6.1:latest`
3. (Optional) SSH deploy to restart the Kubernetes pod



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