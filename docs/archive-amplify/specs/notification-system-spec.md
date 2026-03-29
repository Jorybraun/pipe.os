# Notification System Specification

## 1. Introduction

This document provides a detailed technical specification for the adaptive notification system.

## 2. Trigger Mapping

The following table defines the mapping between status/stage changes and email triggers:

| Model   | Field    | Change Type | Status/Value | Email Trigger                                 |
| ------- | -------- | ----------- | ------------ | --------------------------------------------- |
| Stage   | status   | Update      | PASSED       | Send "Stage Passed" email from template      |
| Stage   | status   | Update      | FAILED       | Send "Stage Failed" email from template      |
| Stage   | status   | Update      | SCHEDULING   | Send "Interview Scheduling" email from template |
| Pipeline|          | Create      | N/A          | Send "Pipeline Created" email to recruiter    |

## 3. Variable Dictionary

The following table lists all supported template variables:

| Variable       | Description                               | Data Source                               |
| -------------- | ----------------------------------------- | ----------------------------------------- |
| `{{name}}`     | Candidate name                              | Candidate model                           |
| `{{stageName}}`| Name of the stage                         | Stage model                               |
| `{{pipelineName}}`| Name of the pipeline                       | Pipeline model                            |
| `{{status}}`   | New status of the stage                   | Stage model                               |
| `{{bookingUrl}}`| URL for scheduling an interview          | Scheduling provider API (Calendly/Cal.com) |
| `{{recruiterName}}` | Name of recruiter associated with the pipeline | Pipeline model                           |
| `{{companyName}}` | Name of the company |  Environment Variable or Configuration  |

## 4. Error Handling

The following error handling mechanisms will be implemented:

*   **SES Bounces and Complaints:** Configure SES to send bounce and complaint notifications to a dedicated email address.  Process these notifications to identify and remove invalid email addresses.
*   **Provider API Failures:** Implement retry logic for API calls to Calendly/Cal.com.  Log errors and alert administrators if retries fail.
*   **Template Rendering Errors:**  Catch exceptions during template rendering.  Log errors and send a default notification to the administrator.
*   **DynamoDB Stream Errors:**  Configure the DynamoDB Stream with a Dead Letter Queue (DLQ) to handle failed events.  Monitor the DLQ and reprocess failed events as needed.

## 5. Implementation Details

*   The `notificationAgent` Lambda function will be written in TypeScript.
*   The Lambda function will use the AWS SDK for JavaScript v3.
*   Email templates will be stored in DynamoDB.
*   API keys for Calendly/Cal.com will be stored in AWS Secrets Manager.
*   CloudWatch Alarms will be set up to monitor Lambda function errors and SES bounce/complaint rates.
