const electron = require('electron')
const path = require('path')
const url = require('url')
const dateformat = require('dateformat')
const excel = require('./functions/excel')
const localapp = require('./functions/localapp')

const {app, BrowserWindow, Menu, dialog, ipcMain} = electron
app.showExitPrompt = true

const localfolder = 'POSManager2'

// Global variable
process.env.NODE_ENV = 'development'
let windowMain
let windowSettings
let splashScreen
let currentSavePath = null

global.globalappsettings = {}
global.apptransactions = []

global.unsavedchanges = []

/**
 * @description Initialize
 */
function appInit() {
    localapp.createLocalAppDataSync(localfolder)
    const prevfile = localapp.getCurrentTransactionBook(localfolder)
    if (prevfile != null) {
        const filepath = prevfile[0]
        const transactionbook = excel.openExcelSync(filepath)
        const transaction = getfromExcel(transactionbook, 'Transactions')
        const summaryreport = getfromExcel(transactionbook, 'Summary Report')
        const columns = getfromExcel(transactionbook, 'Columns')
        const apptransact = arrangeTransaction(transaction, summaryreport, columns)
        columns.forEach(item => {
            if (item.column_worn === 'Cost') item.column_price = parseFloat(item.column_price)
        })
        apptransactions = apptransact
        localapp.updateColumnOnly(localfolder, columns, result => {
            globalappsettings = result
        })

        // change save path
        currentSavePath = filepath
    }
}

/**
 * @description Function to create the main window
 */
function createWindowMain(){
    windowMain = new BrowserWindow({
        'height' : 600,
        'width' : 1000,
        'minHeight' : 600,
        'minWIdth' : 1000,
        'show' : false
    })

    windowMain.loadURL(url.format({
        pathname : path.join(__dirname, 'browserwindows/index/index.html'),
        protocol : 'file',
        slashes : true
    }))

    windowMain.on('close', (e) => {
        if (unsavedchanges.length > 0) {
            // https://github.com/electron/electron/issues/2301
            // handle if there are unsaved changes
            if (app.showExitPrompt) {
                e.preventDefault()
                const buttons = ['Yes', 'No', 'Cancel']
                dialog.showMessageBox(windowMain, {
                    options: ['question'],
                    title: 'Unsaved changes',
                    message: 'Do you want to save your unsaved changes before exit?',
                    buttons: buttons
                }, response => {
                    if (buttons[response] === 'Yes') {
                        // save
                        windowMain.hide()
                        excel.saveAsExcel(globalappsettings.columns, apptransactions, currentSavePath, (err) => {
                            if (err) throw err
                            setTimeout(() => {
                                app.showExitPrompt = false
                                windowMain.close()
                            }, 1000)
                        })
                    } else if (buttons[response] === 'No') {
                        app.showExitPrompt = false
                        windowMain.close()
                    }
                })
            }
        }
    })

    const menu = Menu.buildFromTemplate(menuTemplate)
    // window Main Menu only
    windowMain.setMenu(menu)

    // all windows
    // Menu.setApplicationMenu(menu)

    localapp.getColumnSetting(localfolder, (data) => {
        globalappsettings = data
        windowMain.appsettings = globalappsettings
    })
    windowMain.once('ready-to-show', () => {
        splashScreen.close()
        windowMain.show()
    })
}

/**
 * @description Function to create the splash screen window
 */
function createSplashScreen() {
    splashScreen = new BrowserWindow({
        frame : false,
        resizable : false,
        transparent : true,
        width: 200, 
        height: 400,
    })
    splashScreen.loadURL(url.format({
        pathname : path.join(__dirname, 'browserwindows/splash/splash.html'),
        protocol : 'file',
        slashes : true
    }))
    splashScreen.on('close', () => {
        splashScreen = null
    })
}

/**
 * @description Function to create the column settings window
 */
function createSettingsWindow(){
    windowSettings = new BrowserWindow({
        title: 'User Settings'
    })
    windowSettings.loadURL(url.format({
        pathname: path.join(__dirname, 'browserwindows/column-settings/settings.html'),
        protocol: 'file:',
        slashes: true
    }))
    windowSettings.on('close', () => {
        windowSettings = null
    })
    windowSettings.appsettings = JSON.stringify(globalappsettings)
    // set menu to null
    windowSettings.setMenu(null)
}

app.on('ready', () => {
    createSplashScreen()
    appInit()
    createWindowMain()
})

app.on('window-all-closed', () => {
    if(process.platform != 'darwin')
        app.quit()
})

/**
 * ipcMain
 */
ipcMain.on('settings:update', (err, item) => {
    unsavedchanges.push('updated settings')
    itemupdate = JSON.parse(item)
    localapp.updateColumnSetting(localfolder, itemupdate, (data) => {
        globalappsettings = data
        windowMain.appsettings = globalappsettings
        windowMain.webContents.send('user:settings', data)
    })
    windowSettings.close()
    windowSettings = null
})

ipcMain.on('settings:cancel', (err, item) => {
    windowSettings.close()
    windowSettings = null
})

ipcMain.on('transact:add', (err, item) => {
    // load from index.html is stringified
    unsavedchanges.push('added transaction')
    const load = JSON.parse(item)
    const transaction = buildtransaction(dateformat(new Date(), 'yyyy-mm-dd HH:MM:ss'), load)
    console.log(transaction)
    apptransactions.push(transaction)
    
    windowMain.webContents.send('table:add', JSON.stringify(transaction))
})

// function to build transaction
function buildtransaction (date, load) {
    let total = 0
    load.forEach(item => {
        if (item.type === 'cost') total += (item.value.price * item.value.quantity)
    })
    return {
        date : date,
        transact : load,
        total : total
    }
}

// function for save as dialog
function saveAsFile(){
    windowMain.webContents.executeJavaScript(`document.querySelector('input#work-title').value`, (title) => {
        const options = {
            defaultPath: title,
            buttonLabel : 'Save As',
            filters : [
                {
                    name : 'Excel Workbook',
                    extensions : ['xlsx']
                }
            ]
        }
        dialog.showSaveDialog(windowMain, options, (filename) => {
            if (filename !== undefined) {
                excel.saveAsExcel(globalappsettings.columns, apptransactions, filename, (err) => {
                    if (err) throw err
                })
                currentSavePath = filename
            }
            console.log('Saved in ' + filename)
        })
    })
}

const getfromExcel = (array, find) => array.filter(obj => obj[find])[0][find]

/**
 * @description arrange transaction to use for data
 * @param {Array} transaction 
 * @param {Object} summary 
 * @param {Object} columns 
 */
function arrangeTransaction (transaction, summary, columns) {
    const apptransaction = []
    function buildsingletransaction (name, type, value) {
        return {
            name : name,
            type : type,
            value : value
        }
    }
    transaction.forEach(item => {
        const date = item['date_time']
        let transactarr = []
        let total = 0
        for (key in item) {
            if (key !== 'date_time'){
                const foundcolumn = columns.find(obj => obj['column_id'] === key)
                const name = key
                const type = foundcolumn['column_worn'].toLowerCase()
                let value
                if (type === 'cost'){
                    const foundsummary = summary.filter(obj => obj['prod_name'] === key)
                    const valfromxl = parseFloat(item[key])
                    const sumprice = foundsummary.find(obj => valfromxl % parseFloat(obj['prod_price']) == 0)
                    const price = parseFloat(sumprice['prod_price'])
                    const qty = valfromxl / price
                    total += valfromxl
                    value = {
                        price : price,
                        quantity : qty
                    }
                } else if (type === 'name'){
                    value = item[key]
                }
                transactarr.push(buildsingletransaction(name, type, value))
            }
        }
        apptransaction.push({
            date : date,
            transact : transactarr,
            total : total
        })
    })
    return apptransaction
}

// Menu Template
const menuTemplate = [
    {
        label: 'File',
        submenu:[
            {
                label: 'New Transaction Book',
                accelerator: process.platform === 'darwin' ? 'Command+N' : 'Ctrl+N',
                click() {
                    const options = {
                        title : 'New Transaction Book',
                        filters : [
                            {
                                name : 'Excel Workbook',
                                extensions : ['xlsx']
                            }
                        ]
                    }
                    dialog.showSaveDialog(windowMain, options, (filename) => {
                        if (filename !== undefined) {
                            excel.saveNewExcel(filename, (file) => {
                                localapp.setCurrentTransactionBook(localfolder, file, (err) => {
                                    if (err) throw err
                                    const f = localapp.getCurrentTransactionBook(localfolder)
                                    app.relaunch({args: process.argv.slice(1).concat(['--relaunch'])})
                                    app.exit(0)
                                })
                            })
                        }
                    })
                }
            },
            {
                label: 'Open File',
                accelerator:process.platform === 'darwin' ? 'Command+O' : 'Ctrl+O',
                click(){
                    
                    const options = {
                        title : 'Open Excel Workbook',
                        filters : [
                            {name : 'Excel Workbook', extensions : ['xlsx']}
                        ],
                        properties : ['openFile']
                    }
                    dialog.showOpenDialog(windowMain, options, (filename) => {
                        if (filename !== undefined) {
                            filename = filename[0]
                            excel.openExcel(filename, (err, result) => {
                                if (err) throw err
                                localapp.setCurrentTransactionBook(localfolder, filename, () => {
                                    if (err) throw err
                                    app.relaunch({args: process.argv.slice(1).concat(['--relaunch'])})
                                    app.exit(0)
                                })
                            })
                        }
                    })
                }
            },
            {
                label: 'Save',
                accelerator:process.platform === 'darwin' ? 'Command+S' : 'Ctrl+S',
                click(){
                    if (currentSavePath != null) {
                        // has saved file
                        if (unsavedchanges.length > 0) {
                            unsavedchanges = []
                            excel.saveAsExcel(globalappsettings.columns, apptransactions, currentSavePath, (err) => {
                                if (err) throw err
                            })
                        }
                    } else {
                        // has no current saved file
                        saveAsFile()
                    }
                }
            },
            {
                label: 'Save As...',
                accelerator:process.platform === 'darwin' ? 'Command+Shift+S' : 'Ctrl+Shift+S',
                click(){
                    saveAsFile()
                }
            },
            {
                label: 'Quit',
                accelerator:process.platform === 'darwin' ? 'Command+Q' : 'Ctrl+Q',
                click(){
                    const buttons = ['Yes', 'No']
                    dialog.showMessageBox(windowMain, {
                        options: ['question'],
                        title: 'Chain',
                        message: 'Do you really want to quit?',
                        buttons: buttons
                    }, (response) => {
                        if (buttons[response] === 'Yes'){
                            app.quit()
                        }
                    })
                }
            }
        ]
    },
    {
        label: 'Settings',
        submenu: [
            {
                label: 'Open Settings',
                accelerator:process.platform === 'darwin' ? 'Command+P' : 'Ctrl+P',
                click(){
                    createSettingsWindow()
                }
            }
        ]
    }
]

if (process.platform === 'darwin'){
    menu.unshift({})
}

if (process.env.NODE_ENV !== 'production'){
    menuTemplate.push({
        label: 'Developer Tools',
        submenu: [
            {
                label: 'Toggle DevTools',
                accelerator:process.platform === 'darwin' ? 'Command+I' : 'F12',
                click(item, focusedWindow){
                    focusedWindow.toggleDevTools();
                }
            },
            {
                role: 'reload'
            }
        ]
    })
}