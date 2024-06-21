const CheckAuth=((req,res,next)=>{
    console.log('Middleware Called')
    next()
   })
   
   module.exports= CheckAuth