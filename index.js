const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const app = express();
const session = require('express-session');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
const { createReadStream } = require('streamifier');
const port = process.env.PORT;
const keyFilePath = path.join(__dirname, 'finalproject-413014-fb11cd023fb3.json');
const storage = new Storage({
    keyFilename: keyFilePath,
});
console.log(storage);
app.use(express.static(path.join(__dirname, "static")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(session({
    secret: 'your secret key',  // Choose a secret for session encoding
    resave: false,
    saveUninitialized: true
}));

// Function to read CSV file from GCS
async function readCSV(filePath) {
    const file = storage.bucket('my-csv-buckett').file(filePath);
    const data = [];
    return new Promise((resolve, reject) => {
        file.createReadStream()
            .pipe(csv())
            .on('data', (row) => {
                data.push(row);
            })
            .on('end', () => {
                resolve(data);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

// Function to write to CSV file in GCS
async function writeCSV(filePath, data) {
    const file = storage.bucket('my-csv-buckett').file(filePath);
    const csvWriter = createCsvWriter({
        path: 'temp.csv', // Temporarily write to a local file
        header: Object.keys(data[0]).map((key) => ({ id: key, title: key })),
    });
    await csvWriter.writeRecords(data);
    fs.createReadStream('temp.csv')
        .pipe(file.createWriteStream())
        .on('error', function(err) {})
        .on('finish', function() {
            // The file upload is complete.
            console.log("Upload to GCS completed");
            fs.unlinkSync('temp.csv');
        });
}

// let fileCounter = 0; // Define a global counter for the file name
//
// async function writeCSV(filePath, data) {
//     const file = storage.bucket('my-csv-buckett').file(filePath);
//     const csvWriter = createCsvWriter({
//         path: `temp_${fileCounter}.csv`, // Use the counter in the file name
//         header: Object.keys(data[0]).map((key) => ({ id: key, title: key })),
//     });
//     await csvWriter.writeRecords(data);
//     fs.createReadStream(`temp_${fileCounter}.csv`)
//         .pipe(file.createWriteStream())
//         .on('error', function(err) {})
//         .on('finish', function() {
//             // The file upload is complete.
//             console.log("Upload to GCS completed");
//             fs.unlinkSync(`temp_${fileCounter}.csv`);
//         });
//
//     fileCounter++; // Increment the counter for the next file
// }


function readPasswordsFromCSV() {
    return new Promise(async (resolve, reject) => {
        const filePath = 'Input.csv';  // Assuming the file is in the root of your GCS bucket
        const file = storage.bucket('my-csv-buckett').file(filePath);
        try {
            const fileContents = await file.download();
            const passwords = fileContents[0].toString().split('\n').map(line => {
                const parts = line.split(',');
                return parts[13]; // Assuming the password is the 14th element in each line
            });
            resolve(passwords);
        } catch (error) {
            reject(error);
        }
    });
}

app.use(session({
    secret: 'your secret key',  // Choose a secret for session encoding
    resave: false,
    saveUninitialized: true
}));

app.post('/submit-code', (req, res) => {
    const code = req.body.code;
    // console.log('Received code:' ${code});
    req.session.userCode = code;
    res.redirect('/mainGame');
});

// Function to generate a random password
function generatePassword() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const passwordLength = 8;
    let password = '';
    for (let i = 0; i < passwordLength; i++) {
        let randomIndex = Math.floor(Math.random() * characters.length);
        password += characters[randomIndex];
    }
    return password;
}

app.post('/submit-consent', async (req, res) => {
    try {
        const inputFilePath = "Input.csv"; // Replace with the actual path to your "Input" CSV file
        const allRows = await readCSV(inputFilePath);
        if (allRows.length === 0) {
            res.send('No rows available!');
            return;
        }
        // Check if all rows have been used
        if (req.session.usedRows && req.session.usedRows.length === allRows.length) {
            res.send('All rows have been used.');
            return;
        }
        // Randomly select a row that hasn't been used
        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * allRows.length);
        } while (req.session.usedRows && req.session.usedRows.includes(randomIndex));
        req.session.selectedIndex = randomIndex;
        req.session.selectedRow = allRows[randomIndex];
        req.session.usedRows = req.session.usedRows || [];
        req.session.usedRows.push(randomIndex);
        // console.log('Selected Row:', req.session.selectedRow);
        res.redirect('/TrainingPage');
    } catch (error) {
        console.error('Error:', error);
        res.send('An error occurred.');
    }
});

app.post('/submit-training-answer', async (req, res) => {
    try {
        const userAnswer = req.body.pitcherColor;
        const selectedIndex = req.session.selectedIndex;
        const columnName = 'TestDecision';
        const csvFilePath = "Input.csv";
        const data = await readCSV(csvFilePath); // Read the existing CSV file
        const updatedData = data.map((row, index) => {
            if (index === selectedIndex) {
                // Update the specific column in the selected row
                return {
                    ...row,
                    [columnName]: userAnswer,
                };
            }
            return row;
        });
        await writeCSV(csvFilePath, updatedData); // Write the updated data back to the existing CSV file
        console.log('User training answer saved to existing CSV file.');
        if (req.session.selectedRow.senario === '1') {
            res.redirect('/ExperimentOneTime');
        } else if (req.session.selectedRow.senario === '2') {
            res.redirect('/ExperimentCrowd');
        } else {
            res.status(500).send('Invalid senario');
        }
    } catch (error) {
        console.error('Error handling form submission:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/submit-experiment-answer-OneTime', async (req, res) => {
    try {
        let uniquePassword;
        let isUnique = false;
        while (!isUnique) {
            uniquePassword = generatePassword();
            const existingPasswords = await readPasswordsFromCSV();
            if (!existingPasswords.includes(uniquePassword)) {
                isUnique = true;
            }
        }
        req.session.generatedPassword = uniquePassword;
        const Signal = req.body.hiddenChosenColor;
        const ChosenColor = req.body.hiddenUserColor;
        const selectedIndex = req.session.selectedIndex;
        const csvFilePath = "Input.csv";
        const data = await readCSV(csvFilePath); // Read the existing CSV file
        // Update the selected row with the details
        const updatedData = data.map((row, index) => {
            if (index === selectedIndex) {
                return {
                    ...row,
                    signal: Signal,
                    decision: ChosenColor,
                    GeneratedPassword: uniquePassword,
                };
            }
            return row;
        });
        // Write the updated data back to the existing CSV file
        await writeCSV(csvFilePath, updatedData);
        console.log('User details saved to existing CSV file.');
        res.redirect('password');
    } catch (error) {
        console.error('Error handling form submission:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/submit-experiment-answer-Crowd', async (req, res) => {
    try {
        const Signal = req.body.hiddenChosenColor;
        const ChosenColor = req.body.hiddenUserColor;
        const selectedIndex = req.session.selectedIndex;
        const csvFilePath = "Input.csv";
        const data = await readCSV(csvFilePath); // Read the CSV file from GCS
        // Generate a unique password
        let uniquePassword;
        let isUnique = false;
        while (!isUnique) {
            uniquePassword = generatePassword();
            const existingPasswords = await readPasswordsFromCSV();
            if (!existingPasswords.includes(uniquePassword)) {
                isUnique = true;
            }
        }
        req.session.generatedPassword = uniquePassword;
        // Update the selected row with the details
        const updatedData = data.map((row, index) => {
            if (index === selectedIndex) {
                return {
                    ...row,
                    signal: Signal,
                    decision: ChosenColor,
                    GeneratedPassword: uniquePassword,
                };
            }
            return row;
        });
        await writeCSV(csvFilePath, updatedData);
        console.log('User details saved to existing CSV file.');
        res.redirect('/password');
    } catch (error) {
        console.error('Error handling form submission:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/ExperimentOneTime', (req, res) => {
    const filePath = path.join(__dirname, 'ExperimentOneTime.html');
    const htmlContent = fs.readFileSync(filePath, 'utf8');
    const updatedHtml = htmlContent.replace(
        /{BallRatio}/g, req.session.selectedRow.BallRatio || ''
    ).replace(
        /{groupsize}/g, req.session.selectedRow.groupsize || ''
    ).replace(
        /{Relative Majority}/g, req.session.selectedRow.RelativeMajority || ''
    ).replace(
        /{OtherColorBallRatio}/g, req.session.selectedRow.OtherColorBallRatio || ''
    );
    res.send(updatedHtml);
});

app.get('/ExperimentCrowd', (req, res) => {
    const filePath = path.join(__dirname, 'ExperimentCrowd.html');
    const htmlContent = fs.readFileSync(filePath, 'utf8');
    const updatedHtml = htmlContent.replace(
        /{BallRatio}/g, req.session.selectedRow.BallRatio || ''
    ).replace(
        /{groupsize}/g, req.session.selectedRow.groupsize || ''
    ).replace(
        /{Relative Majority}/g, req.session.selectedRow.RelativeMajority || ''
    ).replace(
        /{Lottery Card Color}/g, req.session.selectedRow.LotteryCardColor || ''
    ).replace(
        /{OtherColorBallRatio}/g, req.session.selectedRow.OtherColorBallRatio || ''
    );

    res.send(updatedHtml);
});

app.get('/get-password', (req, res) => {
    const generatedPassword = req.session.generatedPassword || 'No password generated';
    res.json({password: generatedPassword});
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'mainGame.html'));
});

app.get('/mainGame', (req, res) => {
    res.sendFile(path.join(__dirname, 'consentForm.html'));
});

app.get('/TrainingPage', (req, res) => {
    res.sendFile(path.join(__dirname, 'TrainingPage.html'));
});

app.get('/password', (req, res) => {
    res.sendFile(path.join(__dirname, 'password.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});