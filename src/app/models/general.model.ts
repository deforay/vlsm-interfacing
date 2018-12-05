

const ipc = require('electron').ipcRenderer;

export class GeneralModel {
    //protected db=null;
    private settings = null;
    private db = null;

    constructor() {
        const Store = require('electron-store');
        const store = new Store();
        let mysql = require('mysql');
        this.settings = store.get('appSettings');

        let mysqlPool = mysql.createPool({
            connectionLimit: 5,
            host: this.settings.mysqlHost,
            user: this.settings.mysqlUser,
            password: this.settings.mysqlPassword,
            database: this.settings.mysqlDb,
            port: this.settings.mysqlPort,
            dateStrings: 'date'
        });

        this.db = mysqlPool;
        this.exec("SET GLOBAL sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''))", [], (res) => {
            console.log(res);
        }, (err) => {
            console.log(err);
        })

    }

    exec(query, data, success, errorf) {
        if (this.db != null) {
            this.db.getConnection((err, connection) => {
                if (err) {
                    try {
                        connection.release();
                    } catch (ex) { }
                    errorf(err);
                    return;
                }
                let sql = connection.query({ sql: query }, data, (errors, results, fields) => {
                    if (!errors) { success(results); connection.destroy(); } else { errorf(errors); connection.destroy(); }
                });
            });
        } else {
            errorf({ "error": "database not found" });
        }
    }

    execend(query, data, success, errorf, endResult) {
        if (this.db != null) {
            this.db.getConnection((err, connection) => {
                if (err) {
                    try {
                        connection.release();
                    } catch (ex) { }
                    errorf(err);
                    return;
                }
                let sql = connection.query({ sql: query }, data);
                sql.on("result", (result, index) => { success(result); });
                sql.on("error", (err) => { connection.destroy(); errorf(err) });
                sql.on("end", () => {
                    if (endResult != null)
                        endResult();
                    if (connection)
                        connection.destroy();
                });
            });
        } else {
            errorf({ "error": "database not found" });
        }
    }

    testConnection(success, errord) {
        let q = ipc.sendSync('db-conn');
        if (q.status == 1000) {
            success(q.data);
        } else {
            errord(q);
        }
    }
}