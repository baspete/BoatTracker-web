/* global require console process Promise module */

const express = require('express'),
  storage = require('azure-storage'),
  app = express();

const headingCorrection = -90;

const query = {
  fix: [
    'RowKey',
    'lat',
    'lon',
    'velocity',
    'accuracy',
    'x',
    'y',
    'z',
    'temp',
    'voltage'
  ]
};

/**
 * Runs a table query with specific page size and continuationToken
 * @ignore
 *
 * @param {TableQuery}             query             Query to execute
 * @param {array}                  results           An array of items to be appended
 * @param {TableContinuationToken} continuationToken Continuation token to continue a query
 * @param {function}               callback          Additional sample operations to run after this one completes
 */
function getTelemetry(query, results, continuationToken, callback) {
  const telemetryTable = `assettracker`;
  storageClient.queryEntities(
    telemetryTable,
    query,
    continuationToken,
    (error, response) => {
      if (error) {
        return callback(error);
      }
      response.entries.map(entry => {
        let fix = {};

        for (let field in entry) {
          if (
            entry[field]._ &&
            field !== 'PartitionKey' &&
            field !== 'RowKey'
          ) {
            switch (field) {
              case 'Timestamp':
                fix[field] = entry[field]._; //String
                break;
              case 'x':
                let heading = Math.round(
                  parseFloat(entry[field]._) + headingCorrection
                );
                if (heading < 0) {
                  heading = 360 + heading;
                }
                fix['heading'] = heading;
                break;
              case 'y':
                fix['pitch'] = Math.round(parseFloat(entry[field]._));
                break;
              case 'z':
                fix['roll'] = Math.round(parseFloat(entry[field]._));
                break;
              default:
                fix[field] = parseFloat(entry[field]._);
            }
          }
        }
        results.push(fix);
      });

      if (response.continuationToken) {
        getTelemetry(query, results, result.continuationToken, callback);
      } else {
        callback(results);
      }
    }
  );
}

// ========================================================================
// API

/**
 * From https://www.npmjs.com/package/azure-storage & https://docs.microsoft.com/en-us/azure/app-service/web-sites-configure
 *
 * When using the Storage SDK, you must provide connection information for the storage account to use. This can be provided using:
 *   1. Environment variables - AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCESS_KEY, or AZURE_STORAGE_CONNECTION_STRING.
 *   2. Constructors - For example, var tableSvc = azure.createTableService(accountName, accountKey);
 *
 * In App Services, connection strings exposed as environment variables have their keys prepended with the connection type. Types are:
 *
 * SQL Server: SQLCONNSTR_
 * MySQL: MYSQLCONNSTR_
 * SQL Database: SQLAZURECONNSTR_
 * Custom: CUSTOMCONNSTR_
 *
 * Example: CUSTOMCONNSTR_AZURE_STORAGE_CONNECTION_STRING
 *
 * Application settings are similar, using the string 'APPSETTING_' as a prefix.
 */

const storageClient = storage.createTableService(
  process.env.CUSTOMCONNSTR_AZURE_STORAGE_CONNECTION_STRING
);

app.use('/api/fixes', (req, res) => {
  let query = '',
    resultsArr = [];
  if (req.query.since) {
    query = new storage.TableQuery()
      .select(query.fix)
      .where('RowKey >= ?', req.query.since);
  } else if (req.query.before) {
    query = new storage.TableQuery()
      .select(query.fix)
      .where('RowKey <= ?', req.query.before);
  } else {
    const now = Date.now(),
      span = 1000 * 60 * 60 * 24, // 24 hours
      since = new Date(now - span).toISOString();
    query = new storage.TableQuery()
      .select(query.fix)
      .where('RowKey >= ?', since);
  }

  getTelemetry(query, resultsArr, null, () => {
    console.log(`/api/fixes returned ${resultsArr.length} items`);
    res.json({
      count: resultsArr.length,
      items: resultsArr
    });
    resultsArr = [];
  });
});

// ========================================================================
// WEB APP
app.use('/', express.static('public'));

// ========================================================================
// WEB SERVER
const port = process.env.PORT || 9000;
app.listen(port);
console.log('stirling app started on port ' + port);
