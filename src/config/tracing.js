import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';
import { config } from './index.js';

let tracingSetup = false;

export const setupTracing = () => {
  if (tracingSetup || !config.features.enableTracing) {
    return;
  }

  const jaegerExporter = new JaegerExporter({
    endpoint: config.monitoring.jaegerEndpoint || 'http://localhost:14268/api/traces',
  });

  const sdk = new NodeSDK({
    serviceName: config.monitoring.serviceName,
    traceExporter: jaegerExporter,
    instrumentations: [
      new ExpressInstrumentation({
        requestHook: (span, info) => {
          span.setAttributes({
            'http.route': info.route?.path,
            'user.id': info.req.user?.id,
            'request.id': info.req.requestId,
          });
        },
      }),
      new MongoDBInstrumentation({
        enhancedDatabaseReporting: true,
      }),
      new RedisInstrumentation({
        dbStatementSerializer: (cmdName, cmdArgs) => {
          return `${cmdName} ${cmdArgs.slice(0, 2).join(' ')}`;
        },
      }),
    ],
  });

  try {
    sdk.start();
    tracingSetup = true;
    console.log('OpenTelemetry tracing initialized successfully');
  } catch (error) {
    console.error('Error initializing OpenTelemetry tracing:', error);
  }
};

export const getTracer = () => {
  if (!config.features.enableTracing) {
    return null;
  }
  
  const { trace } = require('@opentelemetry/api');
  return trace.getTracer(config.monitoring.serviceName);
};