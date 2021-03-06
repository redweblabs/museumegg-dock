const csv = require('csv-streamify');
const fs = require('fs');

module.exports = (function () {
    'use strict';

    // Control the different boundaries - lowest being 6 metres(?)
    const LOW_BOUNDARY = 6;
    const MID_BOUNDARY = 4;
    const HIGH_BOUNDARY = 1;

    // For weightings
    const SCORE_DIVISOR = 10;
    const BASE_HASH_OBJECT = {
        time: 0,
        score: 0,
        timestamp: 0,
    }

    const EXHIBITS = {
        '51496:6493' : 'co8421531',
        '45502:651' : 'co8359400',
        '16690:64093' : 'co8232360',
        '49393:1628' : 'co8427213',
        '25571:44527' : 'co8401352',
        '49245:8103' : 'co8058672'
    }

    // base properties
    var headers = false;
    var filename = '';
    var beacon_data = {};
    var data = [];


    /**
     * Generate the distance based on the power and rssi
     *
     * @param int   power   The power output of the beacon
     * @param int   rssi    The RSSI output of the device
     *
     * @return float
    **/
    function generateDistance(power, rssi) {
        if (rssi === 0) {
            return -1.0;
        }
        let ratio = (rssi*1.0) / power;
        if (ratio < 1.0) {
            return Math.pow(ratio, 10);
        }
        return (0.89976) * Math.pow(ratio, 7.7095) + 0.111;
    }

    /**
     * Get the score from the boundaries based on the distance
     *
     * @param float     distance    The distance
     *
     * @return float
    **/
    function getScore(distance) {
        if (distance > MID_BOUNDARY) {
            return SCORE_DIVISOR/LOW_BOUNDARY;
        }
        if (distance < MID_BOUNDARY && distance > HIGH_BOUNDARY) {
            return SCORE_DIVISOR/MID_BOUNDARY;
        }
        if (distance <= HIGH_BOUNDARY) {
            return SCORE_DIVISOR/HIGH_BOUNDARY;
        }
    }

    /**
     * Update the data attribute with this row
     *
     * @param object    row
    **/
    function updateData(row) {
        beacon_data[row.hash].time++;
        beacon_data[row.hash].score += getScore(row.distance);
        beacon_data[row.hash].timestamp += parseInt(row.time);
    }
    return {
        /**
         * Exposed load function, takes in the filename and creates the output object
         *
         * @param string    filename    The filename and file path
         *
         * @return Promise
        **/
        load : function(filename) {
            // create our CSV parser
            const parser = csv({objectMode: true});
            // pipe our file to the parser
            fs.createReadStream(filename).pipe(parser);
            return new Promise(function(resolve, reject) {
                // reading data from the parser
                parser.on('data', function(line) {
                    if (!headers) {
                        return (headers = line);
                    }
                    // Generate a row from the headers and the current line
                    let row = {};
                    headers.forEach((val, i) => row[val] = line[i]);
                    // Calculate the distance and score
                    row.distance = generateDistance(row.power, row.rssi);
                    if (row.distance < LOW_BOUNDARY) {
                        if (!beacon_data.hasOwnProperty(row.hash)) {
                            beacon_data[row.hash] = Object.assign({}, BASE_HASH_OBJECT);
                        }
                        updateData(row)
                        // backup row to firebase - based on debugging flag
                    }
                });
                // Either resolve the data, or reject with error
                parser.on('end', function() {
                    // Generate the average timestamp for each beacon
                    Object.keys(beacon_data).forEach(hash => (
                        beacon_data[hash].timestamp = parseInt(
                            beacon_data[hash].timestamp / beacon_data[hash].time
                        )
                    ));
                    // Order by time at each point
                    Object.keys(beacon_data)
                        .sort((a, b) => beacon_data[a].timestamp - beacon_data[b].timestamp)
                        // convert the beacon_data object to an array of objects
                        .forEach(function(hash, i) {
                            let obj = {}
                            obj[EXHIBITS[hash]] = beacon_data[hash];
                            data[i] = obj
                            delete beacon_data[hash]
                    });

                    resolve(data)
                })
                parser.on('err', function(err) {
                    reject(err);
                })
            });
        },
        /**
         * Get the top scoring N results from the dataset
         *
         * @param int   amount  The top N results to return
         *
         * @return array
        **/
        top: function (amount) {
            // Edge case for amount and data.length
            if (amount === 0 || amount > data.length) {
                throw 'Not enough data for given amount';
            }
            // Sort the array by the score of each of the objects
            return data
                .sort(function(a, b) {
                    return b[Object.keys(b).pop()].score - a[Object.keys(a).pop()].score;
                })
                // slice n items from the start of the list (the highest scoring)
                .slice(0, amount)
                // sort these n items back into date order
                .sort(function(a, b) {
                    return a[Object.keys(a).pop()].timestamp - b[Object.keys(b).pop()].timestamp;
                });
        }
    }
})();
