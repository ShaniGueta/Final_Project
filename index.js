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


const keyFilePath = path.join(__dirname, 'finalproject-413014-fb11cd023fb3.json');
const storage = new Storage({
    keyFilename: keyFilePath,
});


app.use(express.static(path.join(__dirname, "static")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

app.use(session({
    secret: 'your secret key',  // Choose a secret for session encoding
    resave: false,
    saveUninitialized: true
}));



// // Function to read CSV file
// async function readCSV(filePath) {
//     const data = [];
//     return new Promise((resolve, reject) => {
//         fs.createReadStream(filePath)
//             .pipe(csv())
//             .on('data', (row) => {
//                 data.push(row);
//             })
//             .on('end', () => {
//                 resolve(data);
//             })
//             .on('error', (error) => {
//                 reject(error);
//             });
//     });
// }

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

// Function to write CSV from an array of objects
// async function writeCSV(filePath, data) {
//     const csvWriter = createCsvWriter({
//         path: filePath,
//         header: Object.keys(data[0]).map((key) => ({ id: key, title: key })),
//     });
//
//     return csvWriter.writeRecords(data);
// }


// Function to write CSV to GCS
async function writeCSV(bucketName, filePath, data) {
    const file = storage.bucket(bucketName).file(filePath);

    const csvWriter = createCsvWriter({
        path: 'temp.csv', // Temporarily write to a local file
        header: Object.keys(data[0]).map((key) => ({ id: key, title: key })),
    });

    await csvWriter.writeRecords(data);

    // Streamify the local file for upload
    const stream = createReadStream(fs.readFileSync('temp.csv'));

    // Upload the stream to GCS
    await file.createWriteStream().end(stream);

    // Delete the local file
    fs.unlinkSync('temp.csv');
}

// function readPasswordsFromCSV() {
//     return new Promise((resolve, reject) => {
//         const filePath = path.join(__dirname,"https://storage.googleapis.com/my-csv-buckett/Input.csv");
//         fs.readFile(filePath, 'utf8', (err, data) => {
//             if (err) {
//                 reject(err);
//                 return;
//             }
//             const lines = data.split('\n');
//             const passwords = lines.map(line => {
//                 const parts = line.split(',');
//                 return parts[13]; // Assuming the password is the 14 element in each line
//             });
//             resolve(passwords);
//         });
//     });
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


// Handles the submission of code
app.post('/submit-code', (req, res) => {
    const code = req.body.code;
    console.log('Received code: ${code}');
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



// Route to handle consent form submission
app.post('/submit-consent', async (req, res) => {
    try {
        // Read the CSV file containing user data
        const inputFilePath = "https://storage.googleapis.com/my-csv-buckett/Input.csv"; // Replace with the actual path to your "Input" CSV file
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

        // Store the selected row details in the session
        req.session.selectedRow = allRows[randomIndex];

        // Store the selected row index in the session to prevent reuse
        req.session.usedRows = req.session.usedRows || [];
        req.session.usedRows.push(randomIndex);

        // Now you can access the details of the selected row using the "selectedRow" variable
        console.log('Selected Row:', req.session.selectedRow);

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
        // const csvFilePath = `gs://${process.env.my-csv-buckett}/Input.csv`;
        const csvFilePath = "https://storage.googleapis.com/my-csv-buckett/Input.csv";
        // Read the existing CSV file
        const data = await readCSV(csvFilePath);

        // Update the selected row with the user's answer
        data[selectedIndex][columnName] = userAnswer;

        // Write the updated data back to the existing CSV file
        await writeCSV(csvFilePath, data);

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

// Assuming you have already defined readCSV and writeCSV functions

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

        // Store the generated password and all parameters in the session
        req.session.generatedPassword = uniquePassword;

        // Get the details from the request body
        const Signal = req.body.hiddenChosenColor; //to solve
        const ChosenColor = req.body.hiddenUserColor;

        // Get the selected row index from the session
        const selectedIndex = req.session.selectedIndex;

        // Specify the path to your existing CSV file
        // const csvFilePath = `gs://${process.env.my-csv-buckett}/Input.csv`;
        const csvFilePath = "https://storage.googleapis.com/my-csv-buckett/Input.csv";


        // Read the existing CSV file
        const data = await readCSV(csvFilePath);

        // Update the selected row with the details
        data[selectedIndex]['signal'] = Signal;
        data[selectedIndex]['decision'] = ChosenColor;
        data[selectedIndex]['GeneratedPassword'] = uniquePassword;

        // Write the updated data back to the existing CSV file
        await writeCSV(csvFilePath, data);

        console.log('User details saved to existing CSV file.');

        res.redirect('password');
    } catch (error) {
        console.error('Error handling form submission:', error);
        res.status(500).send('Internal Server Error');
    }
});


app.post('/submit-experiment-answer-Crowd', async (req, res) => {
    try {
        // Get the details from the request body
        const Signal = req.body.hiddenChosenColor;
        const ChosenColor = req.body.hiddenUserColor;

        // Get the selected row index from the session
        const selectedIndex = req.session.selectedIndex;

        // Specify the path to your existing CSV file
        // const csvFilePath = `gs://${process.env.my-csv-buckett}/Input.csv`;
        // const csvFilePath =`gs://${process.env.my-csv-buckett}/Input.csv`;
        const csvFilePath = "https://storage.googleapis.com/my-csv-buckett/Input.csv";

        // Read the existing CSV file
        const data = await readCSV(csvFilePath);

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

        // Store the generated password and all parameters in the session
        req.session.generatedPassword = uniquePassword;

        // Update the selected row with the details
        data[selectedIndex]['signal'] = Signal;
        data[selectedIndex]['decision'] = ChosenColor;
        data[selectedIndex]['GeneratedPassword'] = uniquePassword;

        // Write the updated data back to the existing CSV file
        await writeCSV(csvFilePath, data);

        console.log('User details saved to existing CSV file.');

        res.redirect('/password');
    } catch (error) {
        console.error('Error handling form submission:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/ExperimentOneTime', (req, res) => {
    // Assuming 'ExperimentOneTime.html' is in the same directory as your server file
    const filePath = path.join(__dirname, 'ExperimentOneTime.html');

    // Pass the data directly to the HTML file
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
    // Assuming 'ExperimentOneTime.html' is in the same directory as your server file
    const filePath = path.join(__dirname, 'ExperimentCrowd.html');

    // Pass the data directly to the HTML file
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




// Route to provide the password data
app.get('/get-password', (req, res) => {
    const generatedPassword = req.session.generatedPassword || 'No password generated';
    res.json({password: generatedPassword});
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'mainGame.html'));
});

//pass from main game to consent form
app.get('/mainGame', (req, res) => {
    res.sendFile(path.join(__dirname, 'consentForm.html'));
});

app.get('/TrainingPage', (req, res) => {
    res.sendFile(path.join(__dirname, 'TrainingPage.html'));
});

// Route to serve password.html
app.get('/password', (req, res) => {
    res.sendFile(path.join(__dirname, 'password.html'));
});
//
// app.listen(port, () => {
//     console.log("Server running on port", port);
// });


const port = process.env.PORT;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});