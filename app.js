/* global require console process Promise module */

const express = require('express'),
  storage = require('azure-storage'),
  geomagnetism = require('geomagnetism'),
  app = express();

// Corrections for how the sensor is aligned
// along the axis of the boat.
const corrections = {
  heading: -90,
  pitch: 0,
  roll: -1
};

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
    'voltage',
    'windspeed',
    'winddir',
    'depth'
  ]
};

/**
 * Rounds a number
 * @param {float} value     A number to round
 * @param {int}   precision The number of decimal places to round
 */
function round(value, precision) {
  var multiplier = Math.pow(10, precision || 0);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Runs a table query with specific page size and continuationToken
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
            field !== 'PartitionKey' && // ignore
            field !== 'RowKey' // ignore
          ) {
            switch (field) {
              case 'Timestamp':
                fix[field] = entry[field]._; // string
                break;
              case 'x': // Heading
                let decl = geomagnetism
                  .model()
                  .point([parseFloat(entry.lat._), parseFloat(entry.lon._)])
                  .decl;
                let m = Math.round(
                  parseFloat(entry[field]._) + corrections.heading
                );
                // Calculate true
                let t = Math.round(m + decl);
                fix['heading'] = {
                  mag: m < 0 ? 360 + m : m,
                  true: t < 0 ? 360 + t : t
                };
                break;
              case 'y': // Pitch
                fix['pitch'] = Math.round(
                  parseFloat(entry[field]._) + corrections.pitch
                );
                break;
              case 'z': // Roll
                fix['roll'] = Math.round(
                  parseFloat(entry[field]._) + corrections.roll
                );
                break;
              case 'velocity': // Knots
                fix['velocity'] = round(parseFloat(entry[field]._), 1);
                break;
              default:
                // Otherwise just return the float
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
      span = 1000 * 60 * 60, // 1 hour
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
