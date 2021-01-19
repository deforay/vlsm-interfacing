const ipc = require('electron').ipcRenderer;
const mysql = require('mysql');
const Store = require('electron-store');

export class GeneralModel {

  private settings = null;
  private mysqlPool = null;
  private dbConfig = null;

  constructor() {

    const store = new Store();
    this.settings = store.get('appSettings');
    this.dbConfig = {
      connectionLimit: 1000,
      // connectTimeout: 60 * 60 * 1000,
      // acquireTimeout: 60 * 60 * 1000,
      // timeout: 60 * 60 * 1000,
      host: this.settings.mysqlHost,
      user: this.settings.mysqlUser,
      password: this.settings.mysqlPassword,
      database: this.settings.mysqlDb,
      port: this.settings.mysqlPort,
      dateStrings: 'date'
    };

    this.mysqlPool = mysql.createPool(this.dbConfig);

    // this.mysqlPool.on('connection', function (connection) {
    //   console.log('Connection %d connected', connection.threadId);
    // });
    // this.mysqlPool.on('acquire', function (connection) {
    //   console.log('Connection %d acquired', connection.threadId);
    // });

    // this.mysqlPool.on('enqueue', function () {
    //   console.log('Waiting for available connection slot');
    // });

    // this.mysqlPool.on('release', function (connection) {
    //   console.log('Connection %d released', connection.threadId);
    // });

    this.execQuery("SET GLOBAL CONNECT_TIMEOUT=28800; SET SESSION INTERACTIVE_TIMEOUT=28800; SET SESSION WAIT_TIMEOUT=28800; SET SESSION MAX_EXECUTION_TIME=28800;  SET GLOBAL sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''))", [], (res) => {
      console.log(res);
    }, (err) => {
      console.log(err);
    })

  }

  execQuery(query, data, success, errorf) {
    if (this.mysqlPool != null) {
      this.mysqlPool.getConnection((err, connection) => {
        if (err) {
          try {
            connection.release();
          } catch (ex) { }
          errorf(err);
          return;
        }

        let sql = connection.query({ sql: query }, data, (errors, results, fields) => {
          if (!errors) { success(results); connection.release(); } else { errorf(errors); connection.release(); }
        });

      });
    } else {
      errorf({ "error": "Please check your database connection" });
    }
  }

  execWithCallback(query, data, success, errorf, callback) {
    if (this.mysqlPool != null) {
      this.mysqlPool.getConnection((err, connection) => {
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
          if (callback != null)
            callback();
          if (connection)
            connection.destroy();
        });
      });
    } else {
      errorf({ "error": "database not found" });
    }
  }

  // testConnection(success, err) {
  //   let q = ipc.sendSync('db-conn');
  //   if (q.status == 1000) {
  //     success(q.data);
  //   } else {
  //     err(q);
  //   }
  // }
}
