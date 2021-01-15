const ipc = require('electron').ipcRenderer;
const mysql = require('mysql');
const Store = require('electron-store');

export class GeneralModel {

  private settings = null;
  private mysqlPool = null;

  constructor() {

    const store = new Store();
    this.settings = store.get('appSettings');

    this.mysqlPool = mysql.createPool({
      connectionLimit: 100,
      host: this.settings.mysqlHost,
      user: this.settings.mysqlUser,
      password: this.settings.mysqlPassword,
      database: this.settings.mysqlDb,
      port: this.settings.mysqlPort,
      dateStrings: 'date'
    });

    this.exec("SET GLOBAL sql_mode=(SELECT REPLACE(@@sql_mode,'ONLY_FULL_GROUP_BY',''))", [], (res) => {
      console.log(res);
    }, (err) => {
      console.log(err);
    })

  }

  exec(query, data, success, errorf) {
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
          if (!errors) { success(results); connection.destroy(); } else { errorf(errors); connection.destroy(); }
        });

      });
    } else {
      errorf({ "error": "database not found" });
    }
  }

  execend(query, data, success, errorf, endResult) {
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
